import { describe, expect, it } from "vitest";
import { setupFinance } from "../../test-support.ts";

// "Hoje" nos testes: 15/11/2026 (ver NOW em test-support).
const goalBody = { name: "Viagem para o Chile", targetCents: 800000, deadline: "2027-07-31" };

describe("metas", () => {
	it("exige o token em todas as rotas", async () => {
		const { call } = await setupFinance();
		for (const [method, path] of [
			["GET", "/v1/goals"],
			["POST", "/v1/goals"],
			["GET", "/v1/goals/x"],
			["PATCH", "/v1/goals/x"],
			["DELETE", "/v1/goals/x"],
			["POST", "/v1/goals/x/contributions"],
			["DELETE", "/v1/goals/x/contributions/y"],
		] as const) {
			expect((await call(method, path, method === "GET" ? undefined : {}, null)).status).toBe(401);
		}
	});

	it("lista vazia: sem metas e totais zerados", async () => {
		const { api } = await setupFinance();
		expect((await api.get("/v1/goals")).body).toEqual({
			goals: [],
			totals: { savedCents: 0, targetCents: 0 },
		});
	});

	it("cria a meta com os números do engine (nada guardado ainda)", async () => {
		const { api } = await setupFinance();
		const res = await api.post("/v1/goals", { ...goalBody, icon: "plane", chartSlot: 0 });
		expect(res.status).toBe(201);
		expect(res.body.contributions).toEqual([]);
		expect(res.body.goal).toMatchObject({
			name: "Viagem para o Chile",
			targetCents: 800000,
			deadline: "2027-07-31",
			icon: "plane",
			chartSlot: 0,
			archivedAt: null,
			savedCents: 0,
			remainingCents: 800000,
			percent: 0,
			reached: false,
			monthsLeft: 8,
			monthlyNeededCents: 100000,
			paceCents: 0,
			projectedDate: null,
			// Nasceu hoje e ainda não guardou nada: sem ritmo para cobrar.
			status: "on_track",
		});
	});

	it("Guardar soma ao guardado, atualiza projeção e situação, e devolve a meta pronta", async () => {
		const { api } = await setupFinance();
		const { goal } = (await api.post("/v1/goals", goalBody)).body;
		const res = await api.post(`/v1/goals/${goal.id}/contributions`, { amountCents: 210000 });
		expect(res.status).toBe(201);
		expect(res.body.contribution).toMatchObject({
			goalId: goal.id,
			amountCents: 210000,
			date: "2026-11-15",
			transactionId: null,
		});
		expect(res.body.goal).toMatchObject({
			savedCents: 210000,
			remainingCents: 590000,
			percent: 26,
			monthlyNeededCents: 73750,
			paceCents: 210000,
			projectedDate: "2027-02-15",
			status: "on_track",
		});
		const list = await api.get("/v1/goals");
		expect(list.body.totals).toEqual({ savedCents: 210000, targetCents: 800000 });
		expect(list.body.goals).toHaveLength(1);
		const detail = await api.get(`/v1/goals/${goal.id}`);
		expect(detail.body.contributions.map((c: { amountCents: number }) => c.amountCents)).toEqual([210000]);
	});

	it("remove uma contribuição e recalcula", async () => {
		const { api } = await setupFinance();
		const { goal } = (await api.post("/v1/goals", goalBody)).body;
		const a = (
			await api.post(`/v1/goals/${goal.id}/contributions`, { amountCents: 1000, date: "2026-11-01" })
		).body;
		await api.post(`/v1/goals/${goal.id}/contributions`, { amountCents: 500, date: "2026-11-10" });
		const res = await api.delete(`/v1/goals/${goal.id}/contributions/${a.contribution.id}`);
		expect(res.status).toBe(200);
		expect(res.body.goal.savedCents).toBe(500);
		expect(res.body.contributions).toHaveLength(1);
		expect((await api.delete(`/v1/goals/${goal.id}/contributions/${a.contribution.id}`)).status).toBe(404);
	});

	it("atingir a meta muda a situação", async () => {
		const { api } = await setupFinance();
		const { goal } = (await api.post("/v1/goals", { name: "Pequena", targetCents: 1000 })).body;
		const res = await api.post(`/v1/goals/${goal.id}/contributions`, { amountCents: 1000 });
		expect(res.body.goal).toMatchObject({
			status: "reached",
			percent: 100,
			remainingCents: 0,
			reached: true,
		});
	});

	it("meta sem prazo não tem valor mensal", async () => {
		const { api } = await setupFinance();
		const res = await api.post("/v1/goals", { name: "Sem pressa", targetCents: 50000 });
		expect(res.body.goal).toMatchObject({
			deadline: null,
			monthsLeft: null,
			monthlyNeededCents: null,
			status: "no_deadline",
			icon: "target",
			chartSlot: 0,
		});
	});

	it("edita (null limpa o prazo) e recusa corpo vazio", async () => {
		const { api } = await setupFinance();
		const { goal } = (await api.post("/v1/goals", goalBody)).body;
		const res = await api.patch(`/v1/goals/${goal.id}`, {
			name: "Chile",
			targetCents: 900000,
			deadline: null,
		});
		expect(res.status).toBe(200);
		expect(res.body.goal).toMatchObject({
			name: "Chile",
			targetCents: 900000,
			deadline: null,
			status: "no_deadline",
		});
		expect((await api.patch(`/v1/goals/${goal.id}`, {})).status).toBe(400);
		expect((await api.patch("/v1/goals/fantasma", { name: "X" })).status).toBe(404);
	});

	it("arquivar tira da lista, mantém o detalhe e trava edição e contribuição", async () => {
		const { api } = await setupFinance();
		const { goal } = (await api.post("/v1/goals", goalBody)).body;
		const res = await api.delete(`/v1/goals/${goal.id}`);
		expect(res.status).toBe(200);
		expect(res.body.goal.archivedAt).not.toBeNull();
		expect((await api.get("/v1/goals")).body.goals).toEqual([]);
		expect((await api.get(`/v1/goals/${goal.id}`)).status).toBe(200);
		expect((await api.patch(`/v1/goals/${goal.id}`, { name: "X" })).status).toBe(400);
		expect((await api.post(`/v1/goals/${goal.id}/contributions`, { amountCents: 100 })).status).toBe(400);
		expect((await api.delete("/v1/goals/fantasma")).status).toBe(404);
	});

	it("valida a entrada: centavos inteiros, nome, data, ícone, cor e campos desconhecidos", async () => {
		const { api } = await setupFinance();
		const bads: unknown[] = [
			{ ...goalBody, targetCents: 0 },
			{ ...goalBody, targetCents: 10.5 },
			{ ...goalBody, targetCents: "800" },
			{ ...goalBody, name: "  " },
			{ ...goalBody, deadline: "2027-02-30" },
			{ ...goalBody, icon: "foguete" },
			{ ...goalBody, chartSlot: 10 },
			{ ...goalBody, chartSlot: 1.5 },
			{ ...goalBody, saved: 1 },
		];
		for (const body of bads) expect((await api.post("/v1/goals", body)).status).toBe(400);
		const { goal } = (await api.post("/v1/goals", goalBody)).body;
		for (const body of [
			{ amountCents: 0 },
			{ amountCents: -5 },
			{ amountCents: 1.5 },
			{ amountCents: 100, date: "15/11/2026" },
			{ amountCents: 100, extra: true },
			{},
		]) {
			expect((await api.post(`/v1/goals/${goal.id}/contributions`, body)).status).toBe(400);
		}
		expect((await api.get("/v1/goals")).body.goals).toHaveLength(1);
	});

	it("não aceita guardar com data futura", async () => {
		const { api } = await setupFinance();
		const { goal } = (await api.post("/v1/goals", goalBody)).body;
		const res = await api.post(`/v1/goals/${goal.id}/contributions`, {
			amountCents: 100,
			date: "2026-11-16",
		});
		expect(res.status).toBe(400);
		expect(res.body.error.message).toBe("A data de quando guardou não pode ser no futuro.");
		expect(
			(await api.post(`/v1/goals/${goal.id}/contributions`, { amountCents: 100, date: "2026-11-15" })).status,
		).toBe(201);
	});

	it("conta ligada precisa existir e estar ativa; lançamento de origem precisa existir", async () => {
		const { api, basics } = await setupFinance();
		const { account } = await basics();
		const ok = await api.post("/v1/goals", { ...goalBody, accountId: account.id });
		expect(ok.body.goal.accountId).toBe(account.id);
		expect((await api.post("/v1/goals", { ...goalBody, accountId: "fantasma" })).status).toBe(422);
		const { goal } = ok.body;
		expect(
			(await api.post(`/v1/goals/${goal.id}/contributions`, { amountCents: 100, transactionId: "fantasma" }))
				.status,
		).toBe(422);
		const tx = (
			await api.post("/v1/transactions", {
				kind: "expense",
				amountCents: 5000,
				date: "2026-11-10",
				description: "Para a reserva",
				accountId: account.id,
			})
		).body.transaction;
		const res = await api.post(`/v1/goals/${goal.id}/contributions`, {
			amountCents: 5000,
			transactionId: tx.id,
		});
		expect(res.status).toBe(201);
		expect(res.body.contribution.transactionId).toBe(tx.id);
	});

	it("limita as escritas por aparelho (120 por 10 minutos) mas não a leitura", async () => {
		const { api } = await setupFinance();
		const { goal } = (await api.post("/v1/goals", goalBody)).body;
		for (let i = 0; i < 119; i++) {
			const res = await api.post(`/v1/goals/${goal.id}/contributions`, { amountCents: 1 });
			expect([i, res.status, res.body.error?.message]).toEqual([i, 201, undefined]);
		}
		const limited = await api.post(`/v1/goals/${goal.id}/contributions`, { amountCents: 1 });
		expect(limited.status).toBe(429);
		expect(limited.body.error.code).toBe("muitas_tentativas");
		expect((await api.get("/v1/goals")).status).toBe(200);
	});

	it("a sobra do mês pode ir para uma meta (só a escolha) e arquivar a meta desfaz", async () => {
		const { api, basics } = await setupFinance();
		const { account } = await basics();
		const { goal } = (await api.post("/v1/goals", goalBody)).body;
		const res = await api.patch("/v1/preferences", { leftoverGoalId: goal.id });
		expect(res.body.preferences).toMatchObject({ leftoverGoalId: goal.id, leftoverAccountId: null });
		// Nenhum dinheiro se move: o guardado continua zero.
		expect((await api.get(`/v1/goals/${goal.id}`)).body.goal.savedCents).toBe(0);
		expect(
			(await api.patch("/v1/preferences", { leftoverAccountId: account.id })).body.preferences,
		).toMatchObject({
			leftoverGoalId: null,
			leftoverAccountId: account.id,
		});
		expect((await api.patch("/v1/preferences", { leftoverGoalId: "fantasma" })).status).toBe(422);
		await api.patch("/v1/preferences", { leftoverGoalId: goal.id });
		await api.delete(`/v1/goals/${goal.id}`);
		expect((await api.get("/v1/preferences")).body.preferences.leftoverGoalId).toBeNull();
		expect((await api.patch("/v1/preferences", { leftoverGoalId: goal.id })).status).toBe(422);
		expect(
			(await api.patch("/v1/preferences", { leftoverGoalId: goal.id, leftoverAccountId: account.id })).status,
		).toBe(400);
	});
});
