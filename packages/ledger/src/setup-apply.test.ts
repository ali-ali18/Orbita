import { createMemoryStores, DataError, type Stores } from "@orbita/db";
import type { SetupApplyInput } from "@orbita/shared";
import { describe, expect, it } from "vitest";
import { loadSetupAnalysis, STALE_SETUP_MESSAGE } from "./setup.ts";
import { applySetup, undoSetup } from "./setup-apply.ts";

const TODAY = "2026-11-12";

async function seed() {
	const stores = createMemoryStores({ now: () => new Date("2026-11-12T15:00:00Z") });
	const account = await stores.accounts.create({ name: "Conta Inter", kind: "checking" });
	await stores.categories.ensureDefaults();
	const categories = await stores.categories.list();
	const cat = (slug: string) => categories.find((c) => c.slug === slug)?.id as string;

	const add = (
		date: string,
		amountCents: number,
		description: string,
		kind: "expense" | "income" = "expense",
	) =>
		stores.transactions.create({
			kind,
			amountCents,
			date,
			description,
			accountId: account.id,
			categoryId: kind === "expense" ? cat("outros") : null,
		});

	for (const month of ["2026-07", "2026-08", "2026-09", "2026-10"]) {
		await add(`${month}-08`, 48000, "UNIP*MENSALIDADE 0423");
		await add(`${month}-05`, 500000, "PIX RECEBIDO ACME LTDA", "income");
		// Gastos do dia a dia para o plano ter histórico.
		await add(`${month}-12`, 60000, "Mercado Bom", "expense");
	}
	for (const month of ["2026-08", "2026-09", "2026-10"]) await add(`${month}-10`, 4490, "NETFLIX.COM");
	const padarias = [
		await add("2026-10-02", 3000, "PADARIA SAO JOSE 1234"),
		await add("2026-10-20", 2500, "Padaria São José"),
		await add("2026-11-03", 1500, "padaria sao jose"),
	];
	return { stores, account, cat, padarias };
}

async function inputFrom(stores: Stores, over: Partial<SetupApplyInput> = {}): Promise<SetupApplyInput> {
	const analysis = await loadSetupAnalysis(stores, TODAY);
	const pick = (key: string) => analysis.recurring.find((r) => r.key === key);
	const unip = pick("rec:unip");
	const netflix = pick("rec:netflix");
	const salary = analysis.income;
	if (!unip || !netflix || !salary) throw new Error("fixture sem os achados esperados");
	const cats = await stores.categories.list();
	const cat = (slug: string) => cats.find((c) => c.slug === slug)?.id as string;
	const sub = (r: typeof unip, name: string, categoryId: string) => ({
		key: r.key,
		name,
		categoryId,
		amountCents: r.amountCents,
		dayOfMonth: r.dayOfMonth,
		startDate: r.startDate,
		accountId: r.accountId,
		cardId: r.cardId,
	});
	return {
		subscriptions: [sub(unip, "Faculdade (Unip)", cat("lazer")), sub(netflix, "Netflix", cat("assinaturas"))],
		categoryRules: [
			{
				key: "cat:padaria sao jose",
				pattern: "padaria sao jose",
				categoryId: cat("mercado"),
				applyToExisting: true,
			},
		],
		income: {
			key: salary.key,
			name: "Salário",
			amountCents: salary.amountCents,
			payday: salary.payday,
			accountId: salary.accountId,
		},
		plan: null,
		...over,
	};
}

describe("applySetup / undoSetup", () => {
	it("cria assinaturas, regra, renda e recategoriza o passado; o Desfazer reverte tudo", async () => {
		const { stores, cat, padarias } = await seed();
		const undo = await applySetup(stores, await inputFrom(stores), TODAY);

		const subs = await stores.recurrences.list();
		const byName = [...subs].sort((a, b) => (a.name < b.name ? -1 : 1));
		expect(byName.map((s) => [s.name, s.amountCents, s.dayOfMonth, s.startDate, s.kind])).toEqual([
			["Faculdade (Unip)", 48000, 8, "2026-11-01", "expense"],
			["Netflix", 4490, 10, "2026-11-01", "expense"],
		]);
		expect(byName[0]?.accountId).not.toBeNull();
		expect((await stores.categoryRules.list()).map((r) => [r.pattern, r.categoryId])).toEqual([
			["padaria sao jose", cat("mercado")],
		]);
		for (const p of padarias) expect((await stores.transactions.get(p.id))?.categoryId).toBe(cat("mercado"));
		expect(undo.recategorized).toHaveLength(3);
		const income = await stores.incomeSources.list();
		expect(income.map((i) => [i.name, i.amountCents, i.payday, i.recurring])).toEqual([
			["Salário", 500000, 5, true],
		]);

		await undoSetup(stores, undo);
		expect(await stores.recurrences.list()).toEqual([]);
		expect(await stores.categoryRules.list()).toEqual([]);
		expect(await stores.incomeSources.list()).toEqual([]);
		for (const p of padarias) expect((await stores.transactions.get(p.id))?.categoryId).toBe(cat("outros"));

		// Repetir o Desfazer não falha.
		await expect(undoSetup(stores, undo)).resolves.toBeUndefined();
	});

	it("sem retroativo não mexe nos lançamentos antigos", async () => {
		const { stores, cat, padarias } = await seed();
		const input = await inputFrom(stores);
		const undo = await applySetup(
			stores,
			{
				...input,
				categoryRules: input.categoryRules.map((r) => ({ ...r, applyToExisting: false })),
			},
			TODAY,
		);
		expect(undo.recategorized).toEqual([]);
		expect((await stores.transactions.get(padarias[0]?.id ?? ""))?.categoryId).toBe(cat("outros"));
		expect(await stores.categoryRules.list()).toHaveLength(1);
	});

	it("aplica o plano da renda por último e o Desfazer devolve o orçamento", async () => {
		const { stores } = await seed();
		const before = await stores.budgets.list();
		const undo = await applySetup(stores, await inputFrom(stores, { plan: { reservePercent: 10 } }), TODAY);
		expect(undo.previousBudgets).not.toBeNull();
		expect((await stores.budgets.list()).length).toBeGreaterThan(0);
		await undoSetup(stores, undo);
		expect(await stores.budgets.list()).toEqual(before);
	});

	it("recusa número que não bate com o histórico e não grava nada", async () => {
		const { stores } = await seed();
		const input = await inputFrom(stores);
		const forged: SetupApplyInput = {
			...input,
			subscriptions: input.subscriptions.map((s) => ({ ...s, amountCents: s.amountCents + 1 })),
		};
		await expect(applySetup(stores, forged, TODAY)).rejects.toThrow(STALE_SETUP_MESSAGE);
		const wrongDay: SetupApplyInput = {
			...input,
			subscriptions: input.subscriptions.map((s) => ({ ...s, dayOfMonth: s.dayOfMonth === 1 ? 2 : 1 })),
		};
		await expect(applySetup(stores, wrongDay, TODAY)).rejects.toThrow(STALE_SETUP_MESSAGE);
		const invented: SetupApplyInput = {
			...input,
			subscriptions: [{ ...(input.subscriptions[0] as object), key: "rec:inventada" } as never],
		};
		await expect(applySetup(stores, invented, TODAY)).rejects.toThrow(STALE_SETUP_MESSAGE);
		const wrongIncome: SetupApplyInput = {
			...input,
			income: { ...(input.income as NonNullable<SetupApplyInput["income"]>), amountCents: 999999 },
		};
		await expect(applySetup(stores, wrongIncome, TODAY)).rejects.toThrow(STALE_SETUP_MESSAGE);
		expect(await stores.recurrences.list()).toEqual([]);
		expect(await stores.incomeSources.list()).toEqual([]);
		expect(await stores.categoryRules.list()).toEqual([]);
	});

	it("não registra de novo uma assinatura que já existe", async () => {
		const { stores, account, cat } = await seed();
		await stores.recurrences.create({
			kind: "expense",
			name: "Netflix",
			amountCents: 4490,
			dayOfMonth: 10,
			startDate: "2026-11-01",
			accountId: account.id,
			categoryId: cat("assinaturas"),
		});
		const analysis = await loadSetupAnalysis(stores, TODAY);
		expect(analysis.recurring.find((r) => r.key === "rec:netflix")?.registered).toBe(true);
		const input = await inputFrom(stores);
		await expect(applySetup(stores, input, TODAY)).rejects.toThrow(STALE_SETUP_MESSAGE);
	});

	it("se um passo falha, desfaz os anteriores (compensação) e devolve o erro", async () => {
		const { stores, cat, padarias } = await seed();
		const input = await inputFrom(stores);
		const broken: Stores = {
			...stores,
			incomeSources: {
				...stores.incomeSources,
				create: async () => {
					throw new DataError("invalid", "A renda falhou.");
				},
			},
		};
		await expect(applySetup(broken, input, TODAY)).rejects.toThrow("A renda falhou.");
		expect(await stores.recurrences.list()).toEqual([]);
		expect(await stores.categoryRules.list()).toEqual([]);
		for (const p of padarias) expect((await stores.transactions.get(p.id))?.categoryId).toBe(cat("outros"));
	});

	it("o Desfazer respeita o que o dono mudou depois", async () => {
		const { stores, cat, padarias } = await seed();
		const undo = await applySetup(stores, await inputFrom(stores), TODAY);
		const [first, second] = padarias;
		await stores.transactions.update(first?.id ?? "", {
			categoryId: cat("lazer"),
			categoryEditedByOwner: true,
		});
		await stores.transactions.softDelete(second?.id ?? "");
		await undoSetup(stores, undo);
		expect((await stores.transactions.get(first?.id ?? ""))?.categoryId).toBe(cat("lazer"));
		expect((await stores.transactions.get(padarias[2]?.id ?? ""))?.categoryId).toBe(cat("outros"));
	});

	it("uma regra que o dono já tem cobre o estabelecimento e deixa a proposta velha", async () => {
		const { stores, cat } = await seed();
		await stores.categoryRules.upsert("padaria sao jose", cat("lazer"));
		const input = await inputFrom(stores);
		// A regra já cobre o estabelecimento: ele nem é mais candidato (a análise não repete o que o dono tem).
		await expect(applySetup(stores, input, TODAY)).rejects.toThrow(STALE_SETUP_MESSAGE);
	});
});
