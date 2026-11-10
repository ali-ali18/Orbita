import { createMemoryStores, DataError, type Stores } from "@orbita/db";
import { builtinAgentSeeds } from "@orbita/shared";
import { describe, expect, it } from "vitest";
import { runEconomyActions, undoActivity } from "./actions.ts";
import { findEconomyAgent, savingsOpportunities } from "./savings.ts";

/*
 * Achados da revisão: (4) o registro nunca fica sem Desfazer, mesmo com falha injetada em cada ponto; (5) o Desfazer
 * não passa por cima do que o dono mudou numa assinatura ou meta; (6) a duplicata autônoma é só o clássico dobro.
 */

const NOW = new Date("2026-11-09T15:00:00Z");
const now = () => NOW;

type Seed = Awaited<ReturnType<typeof seed>>;

async function seed(options: { padaria?: boolean; netflix?: boolean; goal?: boolean; lazer?: boolean } = {}) {
	const stores = createMemoryStores({ now });
	const account = await stores.accounts.create({ name: "Conta", kind: "checking" });
	await stores.categories.ensureDefaults();
	const categories = await stores.categories.list();
	const cat = (slug: string) => categories.find((c) => c.slug === slug)?.id as string;
	await stores.agents.ensureBuiltins(builtinAgentSeeds());
	const agent0 = (await findEconomyAgent(stores)) as NonNullable<
		Awaited<ReturnType<typeof findEconomyAgent>>
	>;
	await stores.agents.update(agent0.id, {
		enabled: true,
		settings: { autonomy: "reversible", maxActionsPerRun: 20 },
	});
	const add = (
		date: string,
		amountCents: number,
		description: string,
		slug: string | null,
		extra: { source?: "pluggy"; externalId?: string } = {},
	) =>
		stores.transactions.create({
			kind: "expense",
			amountCents,
			date,
			description,
			accountId: account.id,
			categoryId: slug === null ? null : cat(slug),
			...extra,
		});
	let padaria: Awaited<ReturnType<typeof add>> | undefined;
	if (options.padaria) {
		await stores.categoryRules.upsert("padaria estrela", cat("mercado"));
		padaria = await add("2026-11-07", 3200, "Padaria Estrela", null);
	}
	if (options.netflix) {
		for (const m of ["2026-07", "2026-08", "2026-09", "2026-10"])
			await add(`${m}-10`, 4490, "NETFLIX.COM", "assinaturas");
	}
	if (options.goal) await add("2026-11-01", 20000, "JUROS DE MORA", "outros");
	if (options.lazer) {
		for (const [i, m] of ["2026-08", "2026-09", "2026-10"].entries())
			await add(`${m}-1${i}`, 30000, `Cinema ${i}`, "lazer");
		await add("2026-11-03", 45000, "Show", "lazer");
	}
	return { stores, add, cat, account, padaria: padaria as NonNullable<typeof padaria> };
}

const run = async (stores: Stores) => {
	const agent = (await findEconomyAgent(stores)) as NonNullable<Awaited<ReturnType<typeof findEconomyAgent>>>;
	return runEconomyActions(stores, now, agent, { reading: await savingsOpportunities(stores, now) });
};

/** Uma cópia das stores em que um método falha (o original continua nas stores de verdade). */
function failing<K extends keyof Stores>(
	stores: Stores,
	key: K,
	method: string,
	error = "banco caiu",
): Stores {
	const inner = stores[key] as unknown as Record<string, (...a: unknown[]) => unknown>;
	return {
		...stores,
		[key]: {
			...inner,
			[method]: async () => {
				throw new Error(error);
			},
		},
	} as Stores;
}

describe("achado 4: o registro nunca fica sem Desfazer", () => {
	it("a reserva já nasce com o Desfazer calculado e em andamento (não se desfaz ainda)", async () => {
		const s = await seed({ padaria: true });
		let seen: { status: string; undo: Record<string, unknown> } | undefined;
		const spy: Stores = {
			...s.stores,
			transactions: {
				...s.stores.transactions,
				update: async (id, patch) => {
					// No instante da gravação, o registro já existe, com o undo, e ainda não aparece como feito.
					const [row] = await s.stores.agentActivity.list();
					seen = row ? { status: row.status, undo: row.undo } : undefined;
					if (row) await expect(undoActivity(s.stores, row.id)).rejects.toMatchObject({ code: "invalid" });
					return s.stores.transactions.update(id, patch);
				},
			},
		};
		await run(spy);
		expect(seen?.status).toBe("applying");
		expect(seen?.undo).toMatchObject({ transactionId: s.padaria.id, previousCategoryId: null });
		const [row] = await s.stores.agentActivity.list();
		expect(row?.status).toBe("done");
	});

	it("a gravação falha ANTES de gravar: o registro fica em andamento (não é apagado) e a próxima passada solta e refaz", async () => {
		const s = await seed({ padaria: true });
		const first = await run(failing(s.stores, "transactions", "update"));
		expect(first.failed).toBe(1);
		const [row] = await s.stores.agentActivity.list();
		expect(row).toMatchObject({ kind: "categorize_transaction", status: "applying" });
		expect(row?.undo).toMatchObject({ transactionId: s.padaria.id });
		expect((await s.stores.transactions.get(s.padaria.id))?.categoryId).toBeNull();

		// Próxima passada (stores sãs): nada gravado, então solta a reserva e refaz.
		const second = await run(s.stores);
		expect(second.applied.map((a) => a.kind)).toEqual(["categorize_transaction"]);
		const [after] = await s.stores.agentActivity.list();
		expect(after?.status).toBe("done");
		expect((await s.stores.transactions.get(s.padaria.id))?.categoryId).toBe(s.cat("mercado"));
	});

	it("a gravação FEZ efeito e o passo final falha: o registro fica e a próxima passada o conclui (sem provar autoria, o Desfazer não mexe)", async () => {
		const s = await seed({ padaria: true });
		const broken: Stores = failing(s.stores, "agentActivity", "finish");
		const first = await run(broken);
		expect(first.failed).toBe(1);
		// A mudança existe e o registro também (nunca "mudança sem registro").
		expect((await s.stores.transactions.get(s.padaria.id))?.categoryId).toBe(s.cat("mercado"));
		const [row] = await s.stores.agentActivity.list();
		expect(row?.status).toBe("applying");
		expect(row?.undo).toMatchObject({ transactionId: s.padaria.id });

		const second = await run(s.stores);
		expect(second.applied).toEqual([]);
		const [done] = await s.stores.agentActivity.list();
		expect(done?.status).toBe("done");
		// Categoria não tem id criado pelo agente: não dá para provar que foi ele, então o Desfazer não mexe.
		expect(done?.undo.unverified).toBe(true);
		const undone = await undoActivity(s.stores, done?.id as string);
		expect(undone.reverted).toBe(false);
		expect((await s.stores.transactions.get(s.padaria.id))?.categoryId).toBe(s.cat("mercado"));
	});

	it("assinatura criada e o passo final falha: a passada seguinte reencontra a assinatura pelo retrato e o Desfazer a arquiva", async () => {
		const s = await seed({ netflix: true });
		await run(failing(s.stores, "agentActivity", "finish"));
		const [created] = await s.stores.recurrences.list();
		expect(created?.name).toBe("Netflix");
		await run(s.stores);
		const [row] = await s.stores.agentActivity.list();
		expect(row).toMatchObject({ kind: "register_subscription", status: "done" });
		expect(row?.undo.recurrenceId).toBe(created?.id);
		expect(await s.stores.recurrences.list()).toHaveLength(1);
		const undone = await undoActivity(s.stores, row?.id as string);
		expect(undone.reverted).toBe(true);
		expect(await s.stores.recurrences.list()).toEqual([]);
	});

	it("falha ao criar a assinatura (nada gravado): o registro não some e a passada seguinte refaz uma vez só", async () => {
		const s = await seed({ netflix: true });
		await run(failing(s.stores, "recurrences", "create"));
		expect((await s.stores.agentActivity.list()).map((a) => a.status)).toEqual(["applying"]);
		await run(s.stores);
		expect(await s.stores.recurrences.list()).toHaveLength(1);
		expect((await s.stores.agentActivity.list()).map((a) => a.status)).toEqual(["done"]);
	});

	it("falha ao criar a meta e ao concluir o limite: cada ponto deixa o registro resolvível", async () => {
		const s = await seed({ goal: true });
		await run(failing(s.stores, "goals", "create"));
		expect(
			(await s.stores.agentActivity.list()).some(
				(a) => a.kind === "create_savings_goal" && a.status === "applying",
			),
		).toBe(true);
		await run(s.stores);
		expect(await s.stores.goals.list()).toHaveLength(1);
		expect((await s.stores.agentActivity.list()).every((a) => a.status === "done")).toBe(true);
	});

	it("falha só na leitura (antes de reservar): nada é gravado nem registrado", async () => {
		const s = await seed({ padaria: true });
		const result = await run(failing(s.stores, "categories", "get"));
		expect(result.applied).toEqual([]);
		expect(await s.stores.agentActivity.list()).toEqual([]);
		expect((await s.stores.transactions.get(s.padaria.id))?.categoryId).toBeNull();
	});

	it("desfazer uma ação em andamento é recusado sem mexer em nada", async () => {
		const s = await seed({ padaria: true });
		await run(failing(s.stores, "agentActivity", "finish"));
		const [row] = await s.stores.agentActivity.list();
		await expect(undoActivity(s.stores, row?.id as string)).rejects.toBeInstanceOf(DataError);
		expect((await s.stores.transactions.get(s.padaria.id))?.categoryId).toBe(s.cat("mercado"));
		expect((await s.stores.agentActivity.get(row?.id as string))?.status).toBe("applying");
	});
});

describe("achado 5: o Desfazer não passa por cima do que o dono mudou", () => {
	it("assinatura renomeada, com outro valor ou outro dia: só marca como desfeita, com a nota", async () => {
		for (const patch of [{ name: "Netflix da casa" }, { amountCents: 5990 }, { dayOfMonth: 20 }]) {
			const s = await seed({ netflix: true });
			await run(s.stores);
			const [rec] = await s.stores.recurrences.list();
			await s.stores.recurrences.update(rec?.id as string, patch);
			const log = (await s.stores.agentActivity.list()).find((a) => a.kind === "register_subscription");
			const undone = await undoActivity(s.stores, log?.id as string);
			expect(undone.reverted).toBe(false);
			expect(undone.activity.undoNote).toContain("Você já tinha mudado");
			expect((await s.stores.recurrences.get(rec?.id as string))?.archivedAt).toBeNull();
		}
	});

	it("assinatura intacta continua sendo arquivada", async () => {
		const s = await seed({ netflix: true });
		await run(s.stores);
		const log = (await s.stores.agentActivity.list()).find((a) => a.kind === "register_subscription");
		expect((await undoActivity(s.stores, log?.id as string)).reverted).toBe(true);
		expect(await s.stores.recurrences.list()).toEqual([]);
	});

	it("meta renomeada ou com outro alvo: mantida, com a nota", async () => {
		for (const patch of [{ name: "Viagem" }, { targetCents: 999000 }]) {
			const s = await seed({ goal: true });
			await run(s.stores);
			const [goal] = await s.stores.goals.list();
			await s.stores.goals.update(goal?.id as string, patch);
			const log = (await s.stores.agentActivity.list()).find((a) => a.kind === "create_savings_goal");
			const undone = await undoActivity(s.stores, log?.id as string);
			expect(undone.reverted).toBe(false);
			expect(undone.activity.undoNote).toContain("Você já tinha mudado");
			expect(await s.stores.goals.list()).toHaveLength(1);
		}
	});

	it("meta intacta é arquivada", async () => {
		const s = await seed({ goal: true });
		await run(s.stores);
		const log = (await s.stores.agentActivity.list()).find((a) => a.kind === "create_savings_goal");
		expect((await undoActivity(s.stores, log?.id as string)).reverted).toBe(true);
		expect(await s.stores.goals.list()).toEqual([]);
	});
});

describe("achado 6: duplicata autônoma só no clássico dobro", () => {
	const flagged = async (s: Seed) =>
		(await s.stores.agentActivity.list()).filter((a) => a.kind === "flag_duplicate");

	it("passagem igual todo dia e café repetido não vão para 'Para revisar'", async () => {
		const s = await seed();
		for (const d of ["02", "03", "04", "05", "06", "07", "08"]) {
			await s.add(`2026-11-${d}`, 540, "Bilhete Unico", "outros");
			await s.add(`2026-11-${d}`, 540, "Bilhete Unico", "outros", { source: "pluggy", externalId: `p-${d}` });
		}
		await s.add("2026-11-08", 900, "Cafe Central", "outros");
		await s.add("2026-11-08", 900, "Cafe Central", "outros");
		await run(s.stores);
		expect(await flagged(s)).toEqual([]);
	});

	it("duas linhas do próprio banco, mesmo valor e mesmo dia, nunca são marcadas sozinhas", async () => {
		const s = await seed();
		await s.add("2026-11-08", 2990, "Loja da Esquina", "outros", { source: "pluggy", externalId: "p-1" });
		await s.add("2026-11-08", 2990, "Loja da Esquina", "outros", { source: "pluggy", externalId: "p-2" });
		await run(s.stores);
		expect(await flagged(s)).toEqual([]);
	});

	it("dias diferentes, mesmo com origens diferentes, não são marcadas", async () => {
		const s = await seed();
		await s.add("2026-11-07", 2990, "Loja da Esquina", "outros");
		await s.add("2026-11-08", 2990, "Loja da Esquina", "outros", { source: "pluggy", externalId: "p-1" });
		await run(s.stores);
		expect(await flagged(s)).toEqual([]);
	});

	it("o clássico dobro (o lançamento do dono + o do banco, mesmo dia) é marcado: o do dono vai para revisar", async () => {
		const s = await seed();
		const mine = await s.add("2026-11-08", 2990, "Loja da Esquina", "outros");
		const bank = await s.add("2026-11-08", 2990, "Loja da Esquina", "outros", {
			source: "pluggy",
			externalId: "p-1",
		});
		await run(s.stores);
		expect((await flagged(s)).length).toBe(1);
		expect((await s.stores.transactions.get(mine.id))?.status).toBe("pending");
		expect((await s.stores.transactions.get(bank.id))?.status).toBe("confirmed");
	});
});

describe("segunda revisão: o que o dono fez não vira ação do agente por coincidência", () => {
	const kinds = async (s: Seed, kind: string) =>
		(await s.stores.agentActivity.list()).filter((a) => a.kind === kind);

	it("limite: o agente ficou `applying` sem gravar, o dono criou o MESMO limite; o Desfazer não remove o do dono", async () => {
		const s = await seed({ lazer: true });
		await run(failing(s.stores, "budgets", "set"));
		expect((await kinds(s, "set_budget_limit")).map((a) => a.status)).toEqual(["applying"]);
		// O dono toca "Criar limite" no mesmo achado: grava exatamente o limite sugerido.
		await s.stores.budgets.set(s.cat("lazer"), 30000);
		await run(s.stores);
		for (const a of await kinds(s, "set_budget_limit")) {
			if (a.status === "done") await undoActivity(s.stores, a.id);
		}
		expect((await s.stores.budgets.list()).find((b) => b.scope === s.cat("lazer"))?.limitCents).toBe(30000);
	});

	it("assinatura: o dono criou uma igual (nome, valor, dia e início); o Desfazer não arquiva a do dono", async () => {
		const s = await seed({ netflix: true });
		await run(failing(s.stores, "recurrences", "create"));
		const mine = await s.stores.recurrences.create({
			kind: "expense",
			name: "Netflix",
			amountCents: 4490,
			dayOfMonth: 10,
			startDate: "2026-11-01",
			accountId: s.account.id,
		});
		await run(s.stores);
		for (const a of await kinds(s, "register_subscription")) {
			if (a.status === "done") await undoActivity(s.stores, a.id);
		}
		expect((await s.stores.recurrences.get(mine.id))?.archivedAt).toBeNull();
		expect(await s.stores.recurrences.list()).toHaveLength(1);
	});

	it("limite que o agente realmente gravou e ficou sem concluir: não dá para provar que foi ele, então o Desfazer não remove", async () => {
		const s = await seed({ lazer: true });
		await run(failing(s.stores, "agentActivity", "finish"));
		await run(s.stores);
		const [a] = await kinds(s, "set_budget_limit");
		expect(a?.status).toBe("done");
		expect(a?.undo.unverified).toBe(true);
		const undone = await undoActivity(s.stores, a?.id as string);
		expect(undone.reverted).toBe(false);
		expect(undone.activity.undoNote).toContain("Não tenho certeza");
		expect((await s.stores.budgets.list()).find((b) => b.scope === s.cat("lazer"))?.limitCents).toBe(30000);
	});

	it("assinatura e meta que o agente realmente criou e ficaram sem concluir continuam desfazíveis (reconhecidas pelo id)", async () => {
		const s = await seed({ netflix: true, goal: true });
		await run(failing(s.stores, "agentActivity", "finish"));
		await run(s.stores);
		const sub = (await kinds(s, "register_subscription"))[0];
		const goal = (await kinds(s, "create_savings_goal"))[0];
		expect([sub?.status, goal?.status]).toEqual(["done", "done"]);
		expect((await undoActivity(s.stores, sub?.id as string)).reverted).toBe(true);
		expect((await undoActivity(s.stores, goal?.id as string)).reverted).toBe(true);
		expect(await s.stores.recurrences.list()).toEqual([]);
		expect(await s.stores.goals.list()).toEqual([]);
	});

	it("erro determinístico: tenta no máximo 3 vezes e depois fica 'failed', sem novas tentativas", async () => {
		const s = await seed({ netflix: true });
		const broken = failing(s.stores, "recurrences", "create", "validação");
		const results = [];
		for (let i = 0; i < 6; i++) results.push((await run(broken)).failed);
		expect(results).toEqual([1, 1, 1, 0, 0, 0]);
		const [a] = await kinds(s, "register_subscription");
		expect(a?.status).toBe("failed");
		await expect(undoActivity(s.stores, a?.id as string)).rejects.toBeInstanceOf(DataError);
		// Mesmo com o banco são, não insiste (só voltaria a tentar se o achado mudasse de chave).
		expect((await run(s.stores)).applied.map((x) => x.kind)).not.toContain("register_subscription");
		expect(await s.stores.recurrences.list()).toEqual([]);
	});
});
