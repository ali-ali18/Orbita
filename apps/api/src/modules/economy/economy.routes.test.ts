import { findEconomyAgent, runEconomyActions, savingsOpportunities } from "@orbita/ledger";
import { describe, expect, it } from "vitest";
import { type Json, setupFinance } from "../../test-support.ts";

// Hoje: 15/11/2026.
async function scenario() {
	const s = await setupFinance();
	const { api, stores } = s;
	const { account, category } = await s.basics();
	const add = async (date: string, amountCents: number, description: string, slug: string | null) =>
		(
			await api.post("/v1/transactions", {
				kind: "expense",
				amountCents,
				date,
				description,
				accountId: account.id,
				...(slug ? { categoryId: category(slug) } : {}),
			})
		).body.transaction as Json;

	// Duas assinaturas de música cadastradas, com lembrete.
	const recurrence = async (name: string, amountCents: number) =>
		(
			await api.post("/v1/recurrences", {
				kind: "expense",
				name,
				amountCents,
				dayOfMonth: 5,
				startDate: "2026-12-01",
				accountId: account.id,
				remindDayBefore: true,
			})
		).body.recurrence as Json;
	const spotify = await recurrence("Spotify", 2190);
	const deezer = await recurrence("Deezer", 1790);
	// Lazer acima da média.
	for (const [i, month] of ["2026-08", "2026-09", "2026-10"].entries()) {
		await add(`${month}-1${i}`, 30000, `Cinema ${i}`, "lazer");
	}
	await add("2026-11-03", 45000, "Show", "lazer");
	await stores.categoryRules.upsert("padaria estrela", category("mercado"));
	const padaria = await add("2026-11-07", 3200, "Padaria Estrela", null);
	return { ...s, category, account, spotify, deezer, padaria };
}

describe("economia: rotas", () => {
	it("exige o token", async () => {
		const { call } = await setupFinance();
		for (const [method, path] of [
			["GET", "/v1/savings"],
			["POST", "/v1/savings/ignore"],
			["POST", "/v1/savings/act"],
			["GET", "/v1/agent-activity"],
			["POST", "/v1/agent-activity/x/undo"],
		] as const) {
			expect((await call(method, path, method === "GET" ? undefined : {}, null)).status).toBe(401);
		}
	});

	it("'Onde cortar': achados do engine com texto pronto, ações possíveis e autonomia padrão 'só avisar'", async () => {
		const { api, category } = await scenario();
		const { status, body } = await api.get("/v1/savings");
		expect(status).toBe(200);
		expect(body).toMatchObject({ month: "2026-11", autonomy: "notify", agentEnabled: false });
		expect(body.agentId).toEqual(expect.any(String));
		const types = body.opportunities.map((o: Json) => o.type);
		expect(types).toEqual(expect.arrayContaining(["duplicate_subscription", "category_above_average"]));

		const music = body.opportunities.find((o: Json) => o.type === "duplicate_subscription");
		expect(music).toMatchObject({
			title: "Assinaturas parecidas: Deezer e Spotify",
			monthlySavingsCents: 1790,
			confidence: "high",
			countsInTotal: true,
			actions: [
				{ id: "cancel_reminder", label: "Cancelar lembrete" },
				{ id: "ignore", label: "Ignorar" },
			],
		});
		expect(music.body).toContain("R$ 17,90");
		const lazer = body.opportunities.find((o: Json) => o.type === "category_above_average");
		expect(lazer.actions.map((a: Json) => a.id)).toEqual(["create_limit", "ignore"]);
		expect(lazer.body).toContain("R$ 450,00");
		expect(lazer.countsInTotal).toBe(false);
		// O total só soma o que não se sobrepõe: aqui, só a música.
		expect(body.totalMonthlySavingsCents).toBe(1790);
		expect(category("lazer")).toBeTruthy();
	});

	it("ignorar tira o achado da lista e do total, e não volta", async () => {
		const { api } = await scenario();
		const before = (await api.get("/v1/savings")).body;
		const key = before.opportunities.find((o: Json) => o.type === "duplicate_subscription").key;
		const after = await api.post("/v1/savings/ignore", { key });
		expect(after.status).toBe(200);
		expect(after.body.opportunities.map((o: Json) => o.key)).not.toContain(key);
		expect(after.body.totalMonthlySavingsCents).toBe(0);
		// Repetir não duplica na lista de ignorados.
		await api.post("/v1/savings/ignore", { key });
		const agent = (await api.get("/v1/agents")).body.agents.find((a: Json) => a.builtinKey === "economia");
		expect(agent.settings.ignored).toEqual([key]);
		expect((await api.post("/v1/savings/ignore", {})).status).toBe(400);
	});

	it("'Cancelar lembrete' desliga o lembrete das assinaturas do achado", async () => {
		const { api, stores, spotify, deezer } = await scenario();
		const key = (await api.get("/v1/savings")).body.opportunities.find(
			(o: Json) => o.type === "duplicate_subscription",
		).key;
		const res = await api.post("/v1/savings/act", { key, action: "cancel_reminder" });
		expect(res.status).toBe(200);
		expect((await stores.recurrences.get(spotify.id))?.remindDayBefore).toBe(false);
		expect((await stores.recurrences.get(deezer.id))?.remindDayBefore).toBe(false);
		// Sem lembrete ligado, a ação some do achado.
		const again = res.body.opportunities.find((o: Json) => o.key === key);
		expect(again.actions.map((a: Json) => a.id)).toEqual(["ignore"]);
		expect((await api.post("/v1/savings/act", { key, action: "cancel_reminder" })).status).toBe(400);
	});

	it("'Criar limite' cria o limite da média na categoria e a ação some", async () => {
		const { api, stores, category } = await scenario();
		const key = (await api.get("/v1/savings")).body.opportunities.find(
			(o: Json) => o.type === "category_above_average",
		).key;
		const res = await api.post("/v1/savings/act", { key, action: "create_limit" });
		expect(res.status).toBe(200);
		expect((await stores.budgets.list()).find((b) => b.scope === category("lazer"))?.limitCents).toBe(30000);
		const lazer = res.body.opportunities.find((o: Json) => o.key === key);
		expect(lazer.actions.map((a: Json) => a.id)).toEqual(["ignore"]);
	});

	it("ação que não cabe no achado, achado que sumiu e corpo inválido", async () => {
		const { api } = await scenario();
		const key = (await api.get("/v1/savings")).body.opportunities.find(
			(o: Json) => o.type === "category_above_average",
		).key;
		// "Cancelar lembrete" não cabe numa categoria.
		expect((await api.post("/v1/savings/act", { key, action: "cancel_reminder" })).status).toBe(400);
		expect(
			(await api.post("/v1/savings/act", { key: "fees:interest:2026-11", action: "create_limit" })).status,
		).toBe(404);
		expect((await api.post("/v1/savings/act", { key, action: "apagar_tudo" })).status).toBe(400);
		expect((await api.post("/v1/savings/act", { key, action: "create_limit", extra: 1 })).status).toBe(400);
	});

	it("o dono escolhe a autonomia nas configurações do agente; valor inválido é recusado", async () => {
		const { api } = await scenario();
		const agent = (await api.get("/v1/agents")).body.agents.find((a: Json) => a.builtinKey === "economia");
		expect(agent.settings).toMatchObject({ autonomy: "notify", maxActionsPerRun: 5, onInvoiceClose: true });
		expect((await api.patch(`/v1/agents/${agent.id}`, { settings: { autonomy: "total" } })).status).toBe(400);
		expect((await api.patch(`/v1/agents/${agent.id}`, { settings: { maxActionsPerRun: 99 } })).status).toBe(
			400,
		);
		const ok = await api.patch(`/v1/agents/${agent.id}`, {
			enabled: true,
			settings: { autonomy: "reversible" },
		});
		expect(ok.status).toBe(200);
		expect(ok.body.agent.settings.autonomy).toBe("reversible");
		expect((await api.get("/v1/savings")).body).toMatchObject({ autonomy: "reversible", agentEnabled: true });
	});
});

describe("economia: registro e Desfazer", () => {
	async function withActivity() {
		const s = await scenario();
		const agent = (await s.api.get("/v1/agents")).body.agents.find((a: Json) => a.builtinKey === "economia");
		await s.api.patch(`/v1/agents/${agent.id}`, { enabled: true, settings: { autonomy: "reversible" } });
		const record = (await findEconomyAgent(s.stores)) as NonNullable<
			Awaited<ReturnType<typeof findEconomyAgent>>
		>;
		const reading = await savingsOpportunities(s.stores, () => new Date("2026-11-15T15:00:00Z"));
		const result = await runEconomyActions(s.stores, () => new Date("2026-11-15T15:00:00Z"), record, {
			reading,
		});
		return { ...s, result };
	}

	it("lista o que o agente fez, com o quê, o porquê e a evidência", async () => {
		const { api, result, padaria } = await withActivity();
		expect(result.applied.length).toBeGreaterThanOrEqual(2);
		const { status, body } = await api.get("/v1/agent-activity");
		expect(status).toBe(200);
		expect(body.activities).toHaveLength(result.applied.length);
		const categorize = body.activities.find((a: Json) => a.kind === "categorize_transaction");
		expect(categorize).toMatchObject({
			summary: "Categorizei um lançamento",
			status: "done",
			canUndo: true,
			undoneAt: null,
			evidenceTransactionIds: [padaria.id],
		});
		expect(categorize.reason).toContain("regra");
		expect((await api.get("/v1/agent-activity?limit=1")).body.activities).toHaveLength(1);
		expect((await api.get("/v1/agent-activity?limit=0")).status).toBe(400);
	});

	it("Desfazer devolve o estado anterior; o segundo toque leva 409; id desconhecido leva 404", async () => {
		const { api, stores, padaria } = await withActivity();
		expect((await stores.transactions.get(padaria.id))?.categoryId).not.toBeNull();
		const { activities } = (await api.get("/v1/agent-activity")).body;
		const categorize = activities.find((a: Json) => a.kind === "categorize_transaction");

		const undone = await api.post(`/v1/agent-activity/${categorize.id}/undo`);
		expect(undone.status).toBe(200);
		expect(undone.body).toMatchObject({
			reverted: true,
			message: "Desfeito.",
			activity: { status: "undone", canUndo: false },
		});
		expect((await stores.transactions.get(padaria.id))?.categoryId).toBeNull();

		const twice = await api.post(`/v1/agent-activity/${categorize.id}/undo`);
		expect(twice.status).toBe(409);
		expect(twice.body.error.code).toBe("ja_desfeito");
		expect((await api.post("/v1/agent-activity/nao-existe/undo")).status).toBe(404);
	});

	it("se o dono já mudou o que o agente fez, o Desfazer não passa por cima e diz por quê", async () => {
		const { api, stores, padaria, category } = await withActivity();
		await stores.transactions.update(padaria.id, {
			categoryId: category("lazer"),
			categoryEditedByOwner: true,
		});
		const { activities } = (await api.get("/v1/agent-activity")).body;
		const categorize = activities.find((a: Json) => a.kind === "categorize_transaction");
		const res = await api.post(`/v1/agent-activity/${categorize.id}/undo`);
		expect(res.status).toBe(200);
		expect(res.body.reverted).toBe(false);
		expect(res.body.message).toContain("Você já tinha mudado");
		expect((await stores.transactions.get(padaria.id))?.categoryId).toBe(category("lazer"));
	});
});
