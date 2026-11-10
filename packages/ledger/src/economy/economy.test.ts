import { AUTONOMOUS_ACTION_KINDS, AUTONOMY_LEVELS, OPPORTUNITY_TYPES } from "@orbita/core";
import { createMemoryStores, DataError, type Stores } from "@orbita/db";
import {
	ACTIVITY_KIND_VALUES,
	AUTONOMY_LEVEL_VALUES,
	builtinAgentSeeds,
	OPPORTUNITY_TYPE_VALUES,
} from "@orbita/shared";
import { describe, expect, it } from "vitest";
import { runEconomyActions, undoActivity } from "./actions.ts";
import { economySettings, findEconomyAgent, savingsOpportunities } from "./savings.ts";

const NOW = new Date("2026-11-09T15:00:00Z");
const now = () => NOW;

async function seed(settings: Record<string, unknown> = { autonomy: "reversible", maxActionsPerRun: 10 }) {
	const stores = createMemoryStores({ now });
	const account = await stores.accounts.create({ name: "Conta Inter", kind: "checking" });
	await stores.categories.ensureDefaults();
	const categories = await stores.categories.list();
	const cat = (slug: string) => categories.find((c) => c.slug === slug)?.id as string;
	await stores.agents.ensureBuiltins(builtinAgentSeeds());
	const economia = (await findEconomyAgent(stores)) as NonNullable<
		Awaited<ReturnType<typeof findEconomyAgent>>
	>;
	await stores.agents.update(economia.id, { enabled: true, settings });

	const add = (date: string, amountCents: number, description: string, categorySlug: string | null) =>
		stores.transactions.create({
			kind: "expense",
			amountCents,
			date,
			description,
			accountId: account.id,
			categoryId: categorySlug === null ? null : cat(categorySlug),
		});

	// Netflix: 4 cobranças mensais (assinatura detectada com confiança, ainda não cadastrada).
	for (const month of ["2026-07", "2026-08", "2026-09", "2026-10"])
		await add(`${month}-10`, 4490, "NETFLIX.COM", "assinaturas");
	// Lazer: média de R$ 300 nos 3 meses e R$ 450 em novembro (categoria acima da média, sem limite).
	for (const [i, month] of ["2026-08", "2026-09", "2026-10"].entries()) {
		await add(`${month}-1${i}`, 30000, `Cinema e bar ${i}`, "lazer");
	}
	await add("2026-11-03", 45000, "Show", "lazer");
	// Juros do cartão: dá um corte mensal que justifica a meta de economia.
	await add("2026-11-01", 20000, "JUROS DE MORA", "outros");
	// Cobrança repetida (mesmo valor e lugar em dias seguidos).
	const first = await add("2026-11-06", 900, "Loja Esquina", "outros");
	// A mesma compra, agora lida do banco: o clássico dobro (mesmo dia, origens diferentes).
	const second = await stores.transactions.create({
		kind: "expense",
		amountCents: 900,
		date: "2026-11-06",
		description: "Loja Esquina",
		accountId: account.id,
		categoryId: cat("outros"),
		source: "pluggy",
		externalId: "pluggy-dup-1",
	});
	// Sem categoria: um com regra aprendida e um que o dono já editou.
	await stores.categoryRules.upsert("padaria estrela", cat("mercado"));
	const padaria = await add("2026-11-07", 3200, "Padaria Estrela", null);
	const edited = await add("2026-11-08", 2800, "Padaria Estrela", null);
	await stores.transactions.update(edited.id, { editedByOwner: true });

	return { stores, economia, cat, padaria, edited, first, second };
}

const run = async (s: Awaited<ReturnType<typeof seed>>) => {
	const agent = (await findEconomyAgent(s.stores)) as NonNullable<
		Awaited<ReturnType<typeof findEconomyAgent>>
	>;
	const reading = await savingsOpportunities(s.stores, now);
	return runEconomyActions(s.stores, now, agent, { reading });
};

describe("leitura 'Onde cortar'", () => {
	it("traz os achados do engine e tira o que o dono ignorou, refazendo o total", async () => {
		const s = await seed({ autonomy: "notify" });
		const reading = await savingsOpportunities(s.stores, now);
		const types = reading.result.opportunities.map((o) => o.type);
		expect(types).toContain("category_above_average");
		expect(types).toContain("fees");
		expect(reading.autonomy).toBe("notify");
		expect(reading.result.totalMonthlySavingsCents).toBeGreaterThan(0);
		const lazer = reading.result.opportunities.find((o) => o.type === "category_above_average");
		expect(lazer?.detail).toMatchObject({ spentCents: 45000, averageCents: 30000, percentAbove: 50 });
		expect(reading.categoryNames[s.cat("lazer")]).toBe("Lazer");
		expect(reading.limitedCategoryIds).toEqual([]);

		const fees = reading.result.opportunities.find((o) => o.type === "fees");
		await s.stores.agents.update(s.economia.id, { settings: { autonomy: "notify", ignored: [fees?.key] } });
		const after = await savingsOpportunities(s.stores, now);
		expect(after.result.opportunities.map((o) => o.key)).not.toContain(fees?.key);
		expect(after.result.totalMonthlySavingsCents).toBe(
			reading.result.totalMonthlySavingsCents - (fees?.monthlySavingsCents ?? 0),
		);
	});

	it("escolhas inválidas voltam ao padrão seguro: só avisar", () => {
		expect(economySettings({ settings: { autonomy: "tudo" } }).autonomy).toBe("notify");
		expect(economySettings(null)).toMatchObject({ autonomy: "notify", maxActionsPerRun: 5, ignored: [] });
	});
});

describe("níveis de autonomia", () => {
	it("'Só avisar' nunca grava nada nem cria registro", async () => {
		const s = await seed({ autonomy: "notify", maxActionsPerRun: 10 });
		const result = await run(s);
		expect(result).toMatchObject({ planned: 0, applied: [], skipped: 0, failed: 0 });
		expect(await s.stores.agentActivity.list()).toEqual([]);
		expect(await s.stores.recurrences.list()).toEqual([]);
		expect(await s.stores.budgets.list()).toEqual([]);
		expect(await s.stores.goals.list()).toEqual([]);
		expect((await s.stores.transactions.get(s.padaria.id))?.categoryId).toBeNull();
	});

	it("'Agir no que é reversível' faz as cinco ações permitidas e registra cada uma com motivo e evidência", async () => {
		const s = await seed();
		const result = await run(s);
		expect(result.failed).toBe(0);
		expect(result.applied.map((a) => a.kind).sort()).toEqual([
			"categorize_transaction",
			"create_savings_goal",
			"flag_duplicate",
			"register_subscription",
			"set_budget_limit",
		]);

		// Assinatura cadastrada, começando no mês seguinte à última cobrança.
		const [netflix] = await s.stores.recurrences.list();
		expect(netflix).toMatchObject({
			name: "Netflix",
			amountCents: 4490,
			startDate: "2026-11-01",
			kind: "expense",
		});
		// Limite criado só onde não havia.
		expect((await s.stores.budgets.list()).find((b) => b.scope === s.cat("lazer"))?.limitCents).toBe(30000);
		// Categorizado por regra do dono, sem ligar nenhuma marca de "editado pelo dono".
		const padaria = await s.stores.transactions.get(s.padaria.id);
		expect(padaria).toMatchObject({
			categoryId: s.cat("mercado"),
			categoryEditedByOwner: false,
			editedByOwner: false,
		});
		// Duplicata marcada para revisão (continua existindo, só vai para "Para revisar").
		// Vai para revisão o lançamento do dono; a linha do banco fica como está.
		expect((await s.stores.transactions.get(s.first.id))?.status).toBe("pending");
		expect((await s.stores.transactions.get(s.second.id))?.status).toBe("confirmed");
		// Meta de economia com 6 meses do corte estimado.
		const [goal] = await s.stores.goals.list();
		expect(goal?.name).toBe("Economia do mês");
		expect(goal?.targetCents).toBeGreaterThan(0);

		const log = await s.stores.agentActivity.list();
		expect(log).toHaveLength(5);
		for (const a of log) {
			expect(a.status).toBe("done");
			expect(a.summary.length).toBeGreaterThan(0);
			expect(a.reason.length).toBeGreaterThan(0);
			expect(Object.keys(a.undo).length).toBeGreaterThan(0);
		}
		const categorize = log.find((a) => a.kind === "categorize_transaction");
		expect(categorize?.evidence.transactionIds).toEqual([s.padaria.id]);
	});

	it("nunca mexe no que o dono editou, no que já tem categoria nem no limite que o dono pôs", async () => {
		const s = await seed();
		await s.stores.budgets.set(s.cat("lazer"), 80000);
		const result = await run(s);
		expect(result.applied.map((a) => a.kind)).not.toContain("set_budget_limit");
		expect((await s.stores.budgets.list()).find((b) => b.scope === s.cat("lazer"))?.limitCents).toBe(80000);
		// O lançamento que o dono editou continua sem categoria.
		expect((await s.stores.transactions.get(s.edited.id))?.categoryId).toBeNull();
	});

	it("respeita o teto de ações por execução", async () => {
		const s = await seed({ autonomy: "reversible", maxActionsPerRun: 2 });
		const result = await run(s);
		expect(result.planned).toBe(2);
		expect(result.applied).toHaveLength(2);
		expect(await s.stores.agentActivity.list()).toHaveLength(2);
		// A próxima execução continua de onde parou, sem repetir.
		const next = await run(s);
		expect(next.applied).toHaveLength(2);
		expect(await s.stores.agentActivity.list()).toHaveLength(4);
	});

	it("é idempotente: rodar de novo não repete nada", async () => {
		const s = await seed();
		await run(s);
		const before = await s.stores.agentActivity.list();
		const again = await run(s);
		expect(again.applied).toEqual([]);
		expect(await s.stores.agentActivity.list()).toHaveLength(before.length);
		expect(await s.stores.recurrences.list()).toHaveLength(1);
	});

	it("o dono mudou o lançamento entre o planejamento e a execução: a ação é pulada e a reserva é solta", async () => {
		const s = await seed();
		const agent = (await findEconomyAgent(s.stores)) as NonNullable<
			Awaited<ReturnType<typeof findEconomyAgent>>
		>;
		const reading = await savingsOpportunities(s.stores, now);
		const realGet = s.stores.transactions.get.bind(s.stores.transactions);
		// Simula a edição do dono no instante exato da execução.
		s.stores.transactions.get = async (id: string) => {
			const t = await realGet(id);
			return t && id === s.padaria.id ? { ...t, editedByOwner: true } : t;
		};
		const result = await runEconomyActions(s.stores, now, agent, { reading });
		expect(result.applied.map((a) => a.kind)).not.toContain("categorize_transaction");
		expect(result.skipped).toBeGreaterThanOrEqual(1);
		expect((await s.stores.agentActivity.keys(agent.id)).has(`categorize:${s.padaria.id}`)).toBe(false);
		expect((await realGet(s.padaria.id))?.categoryId).toBeNull();
	});
});

describe("desfazer", () => {
	it("devolve o estado anterior de cada ação e o que foi desfeito não volta sozinho", async () => {
		const s = await seed();
		await run(s);
		for (const a of await s.stores.agentActivity.list()) {
			const undone = await undoActivity(s.stores, a.id);
			expect(undone.reverted).toBe(true);
			expect(undone.activity).toMatchObject({ status: "undone", undoNote: null });
		}
		expect((await s.stores.transactions.get(s.padaria.id))?.categoryId).toBeNull();
		expect((await s.stores.transactions.get(s.first.id))?.status).toBe("confirmed");
		expect(await s.stores.recurrences.list()).toEqual([]);
		expect(await s.stores.budgets.list()).toEqual([]);
		expect(await s.stores.goals.list()).toEqual([]);

		// Rodar de novo não refaz nada: o registro lembra do que o dono desfez.
		const again = await run(s);
		expect(again.applied).toEqual([]);
		expect(await s.stores.recurrences.list()).toEqual([]);
		expect(await s.stores.goals.list()).toEqual([]);
	});

	it("desfazer duas vezes: só a primeira age, a segunda é recusada", async () => {
		const s = await seed();
		await run(s);
		const [a] = await s.stores.agentActivity.list();
		const results = await Promise.allSettled([
			undoActivity(s.stores, a?.id as string),
			undoActivity(s.stores, a?.id as string),
		]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
		expect(rejected.reason).toBeInstanceOf(DataError);
		expect((rejected.reason as DataError).code).toBe("duplicate");
	});

	it("não encontrada: not_found", async () => {
		const s = await seed();
		await expect(undoActivity(s.stores, "nao-existe")).rejects.toMatchObject({ code: "not_found" });
	});

	it("não passa por cima do que o dono mudou depois: marca como desfeita, com a nota, sem mexer", async () => {
		const s = await seed();
		await run(s);
		// O dono troca a categoria que o agente pôs.
		await s.stores.transactions.update(s.padaria.id, {
			categoryId: s.cat("lazer"),
			categoryEditedByOwner: true,
		});
		// E muda o limite que o agente criou.
		await s.stores.budgets.set(s.cat("lazer"), 55000);
		// E já revisou a duplicata (confirmou).
		await s.stores.transactions.update(s.first.id, { status: "confirmed", editedByOwner: true });
		const log = await s.stores.agentActivity.list();
		const byKind = (k: string) => log.find((a) => a.kind === k) as (typeof log)[number];

		const categorize = await undoActivity(s.stores, byKind("categorize_transaction").id);
		expect(categorize.reverted).toBe(false);
		expect(categorize.activity.undoNote).toContain("Você já tinha mudado");
		expect((await s.stores.transactions.get(s.padaria.id))?.categoryId).toBe(s.cat("lazer"));

		const budget = await undoActivity(s.stores, byKind("set_budget_limit").id);
		expect(budget.reverted).toBe(false);
		expect((await s.stores.budgets.list()).find((b) => b.scope === s.cat("lazer"))?.limitCents).toBe(55000);

		const duplicate = await undoActivity(s.stores, byKind("flag_duplicate").id);
		expect(duplicate.reverted).toBe(false);
		expect((await s.stores.transactions.get(s.first.id))?.editedByOwner).toBe(true);
	});

	it("a meta com dinheiro guardado é mantida", async () => {
		const s = await seed();
		await run(s);
		const [goal] = await s.stores.goals.list();
		await s.stores.goals.addContribution(goal?.id as string, { amountCents: 10000, date: "2026-11-09" });
		const log = (await s.stores.agentActivity.list()).find((a) => a.kind === "create_savings_goal");
		const undone = await undoActivity(s.stores, log?.id as string);
		expect(undone.reverted).toBe(false);
		expect(undone.activity.undoNote).toContain("dinheiro guardado");
		expect(await s.stores.goals.list()).toHaveLength(1);
	});

	it("se devolver o estado falha, a atividade volta a 'feita' e pode ser tentada de novo", async () => {
		const s = await seed();
		await run(s);
		const log = (await s.stores.agentActivity.list()).find((a) => a.kind === "set_budget_limit");
		const realRemove = s.stores.budgets.remove.bind(s.stores.budgets);
		s.stores.budgets.remove = async () => {
			throw new Error("banco fora do ar");
		};
		await expect(undoActivity(s.stores, log?.id as string)).rejects.toThrow("banco fora do ar");
		expect((await s.stores.agentActivity.get(log?.id as string))?.status).toBe("done");
		s.stores.budgets.remove = realRemove;
		expect((await undoActivity(s.stores, log?.id as string)).reverted).toBe(true);
	});
});

describe("o agente não tem como fazer o que nunca faz sozinho", () => {
	/** Registra o nome de cada método chamado numa store, para conferir que só houve leitura onde só deve haver. */
	function spyOn<T extends object>(store: T, calls: string[], label: string): T {
		return new Proxy(store, {
			get(target, prop, receiver) {
				const value = Reflect.get(target, prop, receiver);
				if (typeof value !== "function") return value;
				return (...args: unknown[]) => {
					calls.push(`${label}.${String(prop)}`);
					return (value as (...a: unknown[]) => unknown).apply(target, args);
				};
			},
		});
	}

	it("na execução e no desfazer, contas, cartões, renda, faturas e dados do banco só são lidos; lançamento só muda por update", async () => {
		const s = await seed();
		const calls: string[] = [];
		const stores: Stores = {
			...s.stores,
			accounts: spyOn(s.stores.accounts, calls, "accounts"),
			cards: spyOn(s.stores.cards, calls, "cards"),
			bills: spyOn(s.stores.bills, calls, "bills"),
			incomeSources: spyOn(s.stores.incomeSources, calls, "incomeSources"),
			transactions: spyOn(s.stores.transactions, calls, "transactions"),
			pluggyConnections: spyOn(s.stores.pluggyConnections, calls, "pluggyConnections"),
		};
		const agent = (await findEconomyAgent(stores)) as NonNullable<
			Awaited<ReturnType<typeof findEconomyAgent>>
		>;
		const reading = await savingsOpportunities(stores, now);
		const before = (await s.stores.transactions.listByBudgetMonth("2026-11")).length;
		await runEconomyActions(stores, now, agent, { reading });
		for (const a of await stores.agentActivity.list()) await undoActivity(stores, a.id);

		const READ = /^(get|list|count|exists|find)/;
		const writes = calls.filter((c) => !READ.test(c.split(".")[1] as string));
		// Única escrita permitida: trocar a categoria ou a situação de um lançamento (e voltar).
		expect([...new Set(writes)]).toEqual(["transactions.update"]);
		// Nenhum lançamento foi apagado, criado ou dividido.
		expect((await s.stores.transactions.listByBudgetMonth("2026-11")).length).toBe(before);
	});
});

describe("enumerações espelhadas", () => {
	it("o que o shared lista é exatamente o que o engine produz (nenhuma lista fica para trás)", () => {
		expect([...AUTONOMY_LEVEL_VALUES]).toEqual([...AUTONOMY_LEVELS]);
		expect([...OPPORTUNITY_TYPE_VALUES]).toEqual([...OPPORTUNITY_TYPES]);
		expect([...ACTIVITY_KIND_VALUES]).toEqual([...AUTONOMOUS_ACTION_KINDS]);
	});
});
