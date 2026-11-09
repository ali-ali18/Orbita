import { createMemoryStores, type Stores, type TransactionInput } from "@orbita/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
	BANK_ACCOUNT_ID,
	CARD_ACCOUNT_ID,
	CLIENT_ID,
	CLIENT_SECRET,
	fakePluggy,
	ITEM_ID,
	tx,
} from "./fake-pluggy.ts";
import { type SyncPluggyDeps, syncPluggy } from "./sync.ts";

const NOW = new Date("2026-11-12T09:00:00Z");
type Json = ReturnType<typeof tx>;

describe("syncPluggy: lançamentos antecipados (adota em vez de duplicar)", () => {
	let stores: Stores;
	let accountId: string;
	let cardId: string;
	let foodId: string;

	/** Roda o sync com estas transações do banco e do cartão. */
	const run = (bank: Json[] = [], card: Json[] = []) => {
		const fake = fakePluggy({
			transactions: { [BANK_ACCOUNT_ID]: bank, [CARD_ACCOUNT_ID]: card },
			bills: {
				[CARD_ACCOUNT_ID]: [
					{ id: "bill-nov", dueDate: "2026-11-17T00:00:00.000Z", totalAmount: 830.1, payments: [] },
				],
			},
		});
		const secrets: Record<string, string> = {
			pluggy_client_id: CLIENT_ID,
			pluggy_client_secret: CLIENT_SECRET,
		};
		const deps: SyncPluggyDeps = {
			stores,
			readSecret: async (name) => secrets[name] ?? null,
			fetch: fake.fetch,
			now: () => NOW,
		};
		return syncPluggy(deps);
	};
	const all = () => stores.transactions.listRecent({ limit: 100 });
	const mine = (extra: Partial<TransactionInput> = {}): TransactionInput => ({
		kind: "expense",
		amountCents: 15_237,
		date: "2026-11-02",
		description: "Mercado do bairro",
		accountId,
		...extra,
	});
	const bankMercado = tx("b-1", {
		description: "Mercado",
		amount: -152.37,
		date: "2026-11-03T00:00:00.000Z",
	});

	beforeEach(async () => {
		stores = createMemoryStores({ now: () => NOW });
		await stores.pluggyConnections.add({ id: ITEM_ID, label: "Banco" });
		foodId = (await stores.categories.create({ slug: "mercado", name: "Mercado", chartSlot: 0 })).id;
		await run(); // cria a conta e o cartão
		accountId = (await stores.accounts.list())[0]?.id as string;
		cardId = (await stores.cards.list())[0]?.id as string;
	});

	it("lançamento manual e depois Pluggy: adota, não duplica e mantém o que o dono definiu", async () => {
		const m = await stores.transactions.create(
			mine({ categoryId: foodId, note: "feira", description: "Compras da semana" }),
		);
		const result = await run([bankMercado]);

		const rows = await all();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			id: m.id,
			source: "pluggy",
			externalId: "b-1",
			date: "2026-11-03", // data oficial do banco
			amountCents: 15_237,
			categoryId: foodId,
			description: "Compras da semana",
			note: "feira",
			status: "confirmed",
		});
		expect(result.connections[0]).toMatchObject({ created: 0, adopted: 1 });
		expect(result.connections[0]?.notes.join(" ")).toContain("ligados ao banco");
	});

	it("sync repetido é idempotente", async () => {
		await stores.transactions.create(mine());
		await run([bankMercado]);
		const before = await all();
		const again = await run([bankMercado]);
		expect(await all()).toEqual(before);
		expect(again.connections[0]).toMatchObject({ created: 0 });
		expect(again.connections[0]?.adopted).toBeUndefined();
	});

	it("importado de extrato (pendente) e depois Pluggy: adota", async () => {
		const imported = await stores.transactions.upsertByExternal("import", `account:${accountId}:abc`, {
			...mine({ description: "MERCADO BAIRRO 1234" }),
			status: "pending",
		});
		await run([bankMercado]);
		const rows = await all();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			id: imported.transaction?.id,
			source: "pluggy",
			externalId: "b-1",
			description: "MERCADO BAIRRO 1234",
			status: "pending",
		});
	});

	it("compra no cartão: compara com a data da compra, não da fatura", async () => {
		const m = await stores.transactions.create({
			kind: "expense",
			amountCents: 10_030,
			date: "2026-11-09",
			description: "Livro",
			cardId,
			invoiceMonth: "2026-11",
			categoryId: foodId,
		});
		await run([], [tx("c-1", { description: "Livraria", amount: 100.3, date: "2026-11-10T00:00:00.000Z" })]);
		const rows = await all();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			id: m.id,
			source: "pluggy",
			externalId: "c-1",
			categoryId: foodId,
			cardId,
		});
	});

	it("receita também é adotada", async () => {
		const m = await stores.transactions.create(
			mine({ kind: "income", amountCents: 450_000, date: "2026-11-04", description: "Salário" }),
		);
		await run([
			tx("b-2", {
				description: "Salário",
				type: "CREDIT",
				amount: 4500,
				date: "2026-11-05T00:00:00.000Z",
				category: "Salary",
			}),
		]);
		const rows = await all();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ id: m.id, kind: "income", externalId: "b-2" });
	});

	it("parcela: casa a parcela correspondente (n/N) e as outras seguem separadas", async () => {
		const [p1, p2] = await stores.transactions.createInstallmentGroup([
			{
				kind: "expense",
				amountCents: 25_000,
				date: "2026-10-20",
				description: "Geladeira",
				cardId,
				invoiceMonth: "2026-10",
				installmentNumber: 1,
				installmentCount: 6,
			},
			{
				kind: "expense",
				amountCents: 25_000,
				date: "2026-10-21",
				description: "Geladeira",
				cardId,
				invoiceMonth: "2026-11",
				installmentNumber: 2,
				installmentCount: 6,
			},
		]);
		await run(
			[],
			[
				tx("c-2", {
					description: "Geladeira",
					amount: 250,
					date: "2026-10-20T00:00:00.000Z",
					creditCardMetadata: { installmentNumber: 2, totalInstallments: 6, billId: "bill-1" },
				}),
			],
		);
		const byId = new Map((await all()).map((r) => [r.id, r]));
		// Só a parcela 2/6 foi adotada (a 1/6 tem o mesmo valor e data parecida, mas é outro número).
		expect(byId.get(p2?.id as string)).toMatchObject({
			source: "pluggy",
			externalId: "c-2",
			installmentNumber: 2,
		});
		expect(byId.get(p1?.id as string)).toMatchObject({ source: "manual", externalId: null });
		expect(byId.size).toBe(2);
	});

	describe("pagamento de fatura (Marcar como paga)", () => {
		const debit = (id: string, date: string) =>
			tx(id, {
				description: "Fatura Mastercard",
				amount: -830.1,
				date: `${date}T00:00:00.000Z`,
				category: "Credit card payment",
			});
		const payment = (extra: Partial<TransactionInput> = {}): TransactionInput => ({
			kind: "card_payment",
			amountCents: 83_010,
			date: "2026-11-06",
			description: "Fatura Nubank",
			accountId,
			cardId,
			...extra,
		});

		it("o débito real adota o pagamento manual (data até 5 dias)", async () => {
			const m = await stores.transactions.create(payment({ date: "2026-11-01" }));
			await run([debit("b-4", "2026-11-06")], [tx("c-1", { description: "Livraria", amount: 100.3 })]);
			const pays = (await all()).filter((r) => r.kind === "card_payment");
			expect(pays).toHaveLength(1);
			expect(pays[0]).toMatchObject({ id: m.id, source: "pluggy", externalId: "b-4", date: "2026-11-06" });
		});

		it("fora de 5 dias ou valor diferente: não adota", async () => {
			await stores.transactions.create(payment({ date: "2026-10-31" }));
			await stores.transactions.create(payment({ amountCents: 83_011 }));
			await run([debit("b-4", "2026-11-06")], [tx("c-1", { description: "Livraria", amount: 100.3 })]);
			const pays = (await all()).filter((r) => r.kind === "card_payment");
			expect(pays.filter((r) => r.source === "manual")).toHaveLength(2);
			expect(pays.filter((r) => r.source === "pluggy")).toHaveLength(1);
		});

		it("dois pagamentos manuais iguais: ambíguo, não adota", async () => {
			await stores.transactions.create(payment());
			await stores.transactions.create(payment());
			await run([debit("b-4", "2026-11-06")], [tx("c-1", { description: "Livraria", amount: 100.3 })]);
			const pays = (await all()).filter((r) => r.kind === "card_payment");
			expect(pays.filter((r) => r.source === "manual")).toHaveLength(2);
			expect(pays.filter((r) => r.source === "pluggy")).toHaveLength(1);
		});
	});

	describe("não adota", () => {
		it("dois candidatos iguais: cria o do banco para revisão e avisa", async () => {
			const a = await stores.transactions.create(mine());
			const b = await stores.transactions.create(mine());
			const result = await run([bankMercado]);
			const rows = await all();
			expect(rows).toHaveLength(3);
			const bank = rows.find((r) => r.externalId === "b-1");
			expect(bank).toMatchObject({ source: "pluggy", status: "pending" });
			expect(bank?.note).toContain("Possível duplicata");
			for (const id of [a.id, b.id])
				expect(rows.find((r) => r.id === id)).toMatchObject({ source: "manual", externalId: null });
			expect(result.connections[0]).toMatchObject({ created: 1, possibleDuplicates: 1 });
			expect(result.connections[0]?.adopted).toBeUndefined();
			expect(result.connections[0]?.notes.join(" ")).toContain("foram para revisão");
			// Rodar de novo não muda nada.
			const snapshot = await all();
			await run([bankMercado]);
			expect(await all()).toEqual(snapshot);
		});

		it("dois candidatos, mas um é claramente o mais próximo: adota esse", async () => {
			const near = await stores.transactions.create(mine({ date: "2026-11-03" }));
			const far = await stores.transactions.create(mine({ date: "2026-11-01" }));
			await run([bankMercado]);
			const rows = await all();
			expect(rows).toHaveLength(2);
			expect(rows.find((r) => r.id === near.id)).toMatchObject({ source: "pluggy", externalId: "b-1" });
			expect(rows.find((r) => r.id === far.id)).toMatchObject({ source: "manual" });
		});

		it("valor diferente", async () => {
			await stores.transactions.create(mine({ amountCents: 15_238 }));
			await run([bankMercado]);
			expect((await all()).filter((r) => r.source === "pluggy")).toHaveLength(1);
			expect((await all()).filter((r) => r.source === "manual")).toHaveLength(1);
		});

		it("fora da janela (4 dias)", async () => {
			await stores.transactions.create(mine({ date: "2026-10-30" }));
			await run([bankMercado]);
			const rows = await all();
			expect(rows).toHaveLength(2);
			expect(rows.filter((r) => r.source === "manual")).toHaveLength(1);
		});

		it("no limite da janela (3 dias) adota", async () => {
			await stores.transactions.create(mine({ date: "2026-10-31" }));
			await run([bankMercado]);
			const rows = await all();
			expect(rows).toHaveLength(1);
			expect(rows[0]?.source).toBe("pluggy");
		});

		it("outro tipo (receita do mesmo valor)", async () => {
			await stores.transactions.create(mine({ kind: "income" }));
			await run([bankMercado]);
			const rows = await all();
			expect(rows).toHaveLength(2);
			expect(rows.filter((r) => r.source === "manual")).toHaveLength(1);
		});

		it("conta diferente", async () => {
			const other = await stores.accounts.create({ name: "Outra", kind: "checking" });
			await stores.transactions.create(mine({ accountId: other.id }));
			await run([bankMercado]);
			const rows = await all();
			expect(rows).toHaveLength(2);
			expect(rows.find((r) => r.accountId === other.id)).toMatchObject({ source: "manual" });
		});

		it("parcela de um parcelamento não casa com compra à vista", async () => {
			await stores.transactions.createInstallmentGroup([
				{
					...mine({ accountId: null, cardId, invoiceMonth: "2026-11" }),
					installmentNumber: 1,
					installmentCount: 2,
				},
				{
					...mine({ accountId: null, cardId, invoiceMonth: "2026-12", date: "2026-12-02" }),
					installmentNumber: 2,
					installmentCount: 2,
				},
			]);
			await run([bankMercado]);
			expect((await all()).filter((r) => r.source === "pluggy")).toHaveLength(1);
		});

		it("lançamento do dono apagado não é adotado", async () => {
			const m = await stores.transactions.create(mine());
			await stores.transactions.softDelete(m.id);
			await run([bankMercado]);
			expect(await all()).toHaveLength(1);
		});

		it("lançamento já ligado a outra compra do Pluggy não é adotado de novo", async () => {
			await stores.transactions.create(mine());
			const second = tx("b-9", { description: "Mercado", amount: -152.37, date: "2026-11-04T00:00:00.000Z" });
			await run([bankMercado, second]);
			const rows = await all();
			expect(rows).toHaveLength(2);
			expect(rows.every((r) => r.source === "pluggy")).toBe(true);
		});
	});
});
