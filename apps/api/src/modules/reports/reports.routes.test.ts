import { describe, expect, it } from "vitest";
import { setupFinance } from "../../test-support.ts";

// "Hoje" = 15/11/2026. Cartão: fecha dia 10, vence dia 20.

describe("relatório do mês", () => {
	it("exige o aparelho pareado", async () => {
		const { call } = await setupFinance();
		expect((await call("GET", "/v1/reports", undefined, null)).status).toBe(401);
		expect((await call("GET", "/v1/reports/2026-10", undefined, null)).status).toBe(401);
	});

	it("valida o mês", async () => {
		const { api } = await setupFinance();
		for (const bad of ["2026-13", "2026-1", "outubro", "2026-10-01"]) {
			expect((await api.get(`/v1/reports/${bad}`)).status).toBe(400);
		}
	});

	it("lista só os meses com lançamento, do mais recente ao mais antigo", async () => {
		const { api, basics } = await setupFinance();
		expect((await api.get("/v1/reports")).body).toEqual({ months: [] });
		const b = await basics();
		const spend = (date: string) =>
			api.post("/v1/transactions", {
				kind: "expense",
				amountCents: 1000,
				date,
				description: "x",
				accountId: b.account.id,
			});
		await spend("2026-09-03");
		await spend("2026-11-03");
		await spend("2026-09-20");
		expect((await api.get("/v1/reports")).body).toEqual({ months: ["2026-11", "2026-09"] });
	});

	it("mês sem dado devolve o relatório zerado", async () => {
		const { api } = await setupFinance();
		const { status, body } = await api.get("/v1/reports/2026-10");
		expect(status).toBe(200);
		expect(body.totals).toEqual({
			incomeCents: 0,
			spentCents: 0,
			investedCents: 0,
			balanceCents: 0,
			refundCreditCents: 0,
		});
		expect(body.vsPrevious).toBeNull();
		expect(body.vsAverage).toBeNull();
		expect(body.topCategories).toEqual([]);
	});

	it("monta o relatório com os números do engine, os mesmos do resumo do Início", async () => {
		const { api, basics } = await setupFinance();
		const b = await basics();
		const tx = (kind: string, date: string, amountCents: number, slug: string | null, description: string) =>
			api.post("/v1/transactions", {
				kind,
				amountCents,
				date,
				description,
				accountId: b.account.id,
				...(slug ? { categoryId: b.category(slug) } : {}),
			});
		await tx("income", "2026-10-05", 420000, null, "Salário");
		await tx("income", "2026-09-05", 420000, null, "Salário");
		await tx("expense", "2026-10-10", 98000, "mercado", "Mercado do mês");
		await tx("expense", "2026-10-12", 52000, "delivery", "iFood");
		await tx("expense", "2026-09-10", 111364, "mercado", "Mercado");
		await tx("expense", "2026-09-12", 38806, "delivery", "iFood");
		// Compra no cartão de outubro (cai na fatura que vence em novembro).
		await api.post("/v1/transactions", {
			kind: "expense",
			amountCents: 30000,
			date: "2026-10-02",
			description: "Roupa",
			cardId: b.card.id,
			categoryId: b.category("lazer"),
		});
		await api.put("/v1/budgets", { scope: "total", limitCents: 250000 });
		await api.put("/v1/budgets", { scope: b.category("delivery"), limitCents: 40000 });

		const { status, body } = await api.get("/v1/reports/2026-10");
		expect(status).toBe(200);
		const summary = (await api.get("/v1/summary/2026-10")).body.summary;
		expect(body.totals).toMatchObject({ incomeCents: 420000, spentCents: 180000 });
		expect(body.totals.spentCents).toBe(summary.spentCents);
		expect(body.totals.balanceCents).toBe(240000);
		expect(body.closedOn).toBe("2026-11-01");

		expect(body.vsPrevious.spent).toEqual({ referenceCents: 150170, deltaCents: 29830, percent: 20 });
		expect(body.vsAverage.months).toEqual(["2026-09"]);

		expect(body.topCategories.map((c: { categoryId: string }) => c.categoryId)).toEqual([
			b.category("mercado"),
			b.category("delivery"),
			b.category("lazer"),
		]);
		expect(body.topCategories[1]).toMatchObject({ spentCents: 52000, previousCents: 38806, percent: 34 });
		expect(body.biggestExpenses[0]).toMatchObject({ description: "Mercado do mês", amountCents: 98000 });

		const total = body.budget.rows.find((r: { categoryId: string | null }) => r.categoryId === null);
		expect(total).toMatchObject({ limitCents: 250000, spentCents: 180000, overBudget: false });
		expect(body.budget).toMatchObject({ withinCount: 1, overCount: 1, adherencePercent: 50 });

		expect(body.invoices.cards).toHaveLength(1);
		expect(body.invoices.cards[0]).toMatchObject({ cardId: b.card.id, purchasesCents: 30000 });
		expect(body.invoices.totalCents).toBe(30000);
	});
});
