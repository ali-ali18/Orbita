import { describe, expect, it } from "vitest";
import { setupFinance } from "../../test-support.ts";

// "Hoje" = 15/11/2026: os meses fechados da sugestão são agosto, setembro e outubro.

describe("sugestão da Órbita", () => {
	it("exige o token", async () => {
		const { call } = await setupFinance();
		expect((await call("GET", "/v1/budgets/suggestion", undefined, null)).status).toBe(401);
	});

	it("sem histórico não sugere nada", async () => {
		const { api } = await setupFinance();
		expect((await api.get("/v1/budgets/suggestion")).body).toEqual({
			months: 3,
			monthsUsed: 0,
			totalCents: 0,
			byCategory: {},
		});
	});

	it("mediana dos 3 meses fechados por categoria, em reais; o mês corrente não entra", async () => {
		const { api, basics } = await setupFinance();
		const b = await basics();
		const spend = (date: string, amountCents: number, slug: string) =>
			api.post("/v1/transactions", {
				kind: "expense",
				amountCents,
				date,
				description: `gasto ${date}`,
				accountId: b.account.id,
				categoryId: b.category(slug),
			});
		await spend("2026-08-10", 80000, "mercado");
		await spend("2026-09-10", 90050, "mercado");
		await spend("2026-10-10", 85000, "mercado");
		await spend("2026-10-12", 30000, "lazer");
		// Novembro está em andamento: ignorado.
		await spend("2026-11-02", 900000, "mercado");
		const res = (await api.get("/v1/budgets/suggestion")).body;
		expect(res.months).toBe(3);
		expect(res.monthsUsed).toBe(3);
		// Lazer: valores 0, 0, 30000 -> mediana 0 -> sem sugestão.
		expect(res.byCategory).toEqual({ [b.category("mercado")]: 85000 });
		expect(res.totalCents).toBe(85000);
	});
});

describe("aviso de orçamento no resumo", () => {
	it("marca o limite que passou do percentual das preferências", async () => {
		const { api, basics } = await setupFinance();
		const b = await basics();
		await api.put("/v1/budgets", { scope: b.category("mercado"), limitCents: 10000 });
		await api.put("/v1/budgets", { scope: "total", limitCents: 100000 });
		await api.post("/v1/transactions", {
			kind: "expense",
			amountCents: 8500,
			date: "2026-11-03",
			description: "Mercado",
			accountId: b.account.id,
			categoryId: b.category("mercado"),
		});
		const read = async () => (await api.get("/v1/summary/2026-11")).body;
		let body = await read();
		expect(body.budgetAlertPercent).toBe(80);
		const alertOf = (scope: string) => body.budgets.find((x: { scope: string }) => x.scope === scope).alert;
		expect(alertOf(b.category("mercado"))).toBe(true);
		expect(alertOf("total")).toBe(false);

		await api.patch("/v1/preferences", { budgetAlertPercent: 90 });
		body = await read();
		expect(body.budgetAlertPercent).toBe(90);
		expect(alertOf(b.category("mercado"))).toBe(false);
	});
});

describe("preferências do orçamento", () => {
	it("guarda o percentual do aviso e a conta da sobra, e recusa valores inválidos", async () => {
		const { api, basics } = await setupFinance();
		const { account } = await basics();
		expect((await api.get("/v1/preferences")).body.preferences).toEqual({
			defaultAccountId: null,
			budgetAlertPercent: 80,
			leftoverAccountId: null,
			leftoverGoalId: null,
		});
		const res = await api.patch("/v1/preferences", { budgetAlertPercent: 70, leftoverAccountId: account.id });
		expect(res.body.preferences).toEqual({
			defaultAccountId: null,
			budgetAlertPercent: 70,
			leftoverAccountId: account.id,
			leftoverGoalId: null,
		});
		for (const bad of [0, 101, 80.5, "80"]) {
			expect((await api.patch("/v1/preferences", { budgetAlertPercent: bad })).status).toBe(400);
		}
		expect((await api.patch("/v1/preferences", { leftoverAccountId: "fantasma" })).status).toBe(422);
		expect((await api.patch("/v1/preferences", { leftoverAccountId: null })).body.preferences).toMatchObject({
			leftoverAccountId: null,
			budgetAlertPercent: 70,
		});
	});
});
