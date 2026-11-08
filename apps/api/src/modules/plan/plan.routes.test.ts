import { describe, expect, it } from "vitest";
import { type Json, setupFinance } from "../../test-support.ts";

// "Hoje" = 15/11/2026: os meses fechados do histórico são agosto, setembro e outubro.
const MONTH = "2026-11";

/** O dono do caso real: renda R$ 2.300, gasto mediano R$ 2.775 e R$ 738 em Investimentos. */
async function ownerCase() {
	const t = await setupFinance();
	const b = await t.basics();
	const spend = (date: string, amountCents: number, slug: string) =>
		t.api.post("/v1/transactions", {
			kind: "expense",
			amountCents,
			date,
			description: `gasto ${date} ${slug}`,
			accountId: b.account.id,
			categoryId: b.category(slug),
		});
	for (const month of ["2026-08", "2026-09", "2026-10"]) {
		await spend(`${month}-10`, 150000, "mercado");
		await spend(`${month}-11`, 127500, "lazer");
		await spend(`${month}-12`, 73800, "investimentos");
	}
	await t.api.post("/v1/income", {
		name: "Salário",
		amountCents: 230000,
		payday: 5,
		accountId: b.account.id,
	});
	return { ...t, ...b };
}

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, c) => a + c, 0);

describe("renda", () => {
	it("exige o token em todas as rotas", async () => {
		const { call } = await setupFinance();
		for (const [method, path] of [
			["GET", "/v1/income"],
			["POST", "/v1/income"],
			["PATCH", "/v1/income/x"],
			["DELETE", "/v1/income/x"],
			["GET", `/v1/plan/${MONTH}`],
			["POST", `/v1/plan/${MONTH}/apply`],
			["POST", "/v1/budgets/fit"],
			["POST", "/v1/budgets/restore"],
		] as const) {
			expect((await call(method, path, method === "GET" ? undefined : {}, null)).status).toBe(401);
		}
	});

	it("cadastra o salário e uma renda avulsa; o engine diz o que entra no mês e o próximo pagamento", async () => {
		const { api } = await setupFinance();
		expect((await api.get("/v1/income")).body).toEqual({
			sources: [],
			monthIncomeCents: 0,
			nextPayday: null,
		});
		const salary = await api.post("/v1/income", { name: " Salário ", amountCents: 230000, payday: 5 });
		expect(salary.status).toBe(201);
		expect(salary.body.source).toMatchObject({ name: "Salário", recurring: true, month: null });
		await api.post("/v1/income", {
			name: "Freela",
			amountCents: 50000,
			payday: 20,
			recurring: false,
			month: MONTH,
		});
		const list = (await api.get("/v1/income")).body;
		expect(list.monthIncomeCents).toBe(280000);
		// Hoje é 15/11: o freela cai dia 20 (5 dias); o salário só em 5/12.
		expect(list.nextPayday).toMatchObject({ date: "2026-11-20", daysUntil: 5 });
	});

	it("valida o corpo e edita e arquiva", async () => {
		const { api } = await setupFinance();
		expect((await api.post("/v1/income", { name: "x", amountCents: 100.5, payday: 5 })).status).toBe(400);
		expect((await api.post("/v1/income", { name: "x", amountCents: 100, payday: 40 })).status).toBe(400);
		expect(
			(await api.post("/v1/income", { name: "x", amountCents: 100, payday: 5, recurring: false })).status,
		).toBe(400);
		expect(
			(await api.post("/v1/income", { name: "x", amountCents: 100, payday: 5, accountId: "fantasma" }))
				.status,
		).toBe(422);
		const { id } = (await api.post("/v1/income", { name: "Salário", amountCents: 100000, payday: 31 })).body
			.source;
		const raised = await api.patch(`/v1/income/${id}`, { amountCents: 120000 });
		expect(raised.body.source).toMatchObject({ amountCents: 120000, payday: 31 });
		expect((await api.patch(`/v1/income/${id}`, {})).status).toBe(400);
		expect((await api.patch("/v1/income/nada", { name: "y" })).status).toBe(404);
		expect((await api.delete(`/v1/income/${id}`)).body.source.archivedAt).not.toBeNull();
		expect((await api.get("/v1/income")).body.sources).toEqual([]);
	});
});

describe("sugestão do orçamento com renda", () => {
	it("nunca passa da renda: R$ 2.775 de histórico vira R$ 2.070 (renda menos 10% de reserva), com a explicação", async () => {
		const { api, category } = await ownerCase();
		const s = (await api.get("/v1/budgets/suggestion")).body;
		expect(s.totalCents).toBe(207000);
		expect(sum(s.byCategory)).toBe(207000);
		expect(s.totalCents).toBeLessThanOrEqual(230000);
		// Investimentos não é gasto.
		expect(s.byCategory[category("investimentos")]).toBeUndefined();
		expect(s.cap).toMatchObject({ incomeCents: 230000, wantedCents: 277500, capCents: 207000 });
		expect(s.cap.message).toContain("2.775,00");
		// 150000 : 127500 mantido em proporção, soma exata.
		expect(s.byCategory[category("mercado")]).toBe(111892);
		expect(s.byCategory[category("lazer")]).toBe(95108);
	});

	it("sem renda cadastrada continua a sugestão de antes (mediana, sem teto)", async () => {
		const { api, basics } = await setupFinance();
		const b = await basics();
		await api.post("/v1/transactions", {
			kind: "expense",
			amountCents: 80000,
			date: "2026-10-10",
			description: "mercado",
			accountId: b.account.id,
			categoryId: b.category("mercado"),
		});
		const s = (await api.get("/v1/budgets/suggestion")).body;
		expect(s).toEqual({
			months: 3,
			monthsUsed: 1,
			totalCents: 80000,
			byCategory: { [b.category("mercado")]: 80000 },
		});
	});
});

describe("plano da renda", () => {
	it("monta os baldes do mês e a soma das categorias fecha com o total", async () => {
		const { api, category } = await ownerCase();
		const plan = (await api.get(`/v1/plan/${MONTH}`)).body;
		expect(plan).toMatchObject({
			month: MONTH,
			incomeCents: 230000,
			reservePercent: 10,
			feasible: true,
			buckets: { commitmentsCents: 0, dailyCents: 207000, goalsCents: 0, reserveCents: 23000, leftCents: 0 },
			cut: { wantedCents: 277500, capCents: 207000 },
			monthsUsed: 3,
		});
		expect(plan.budget.totalCents).toBe(sum(plan.budget.byCategory));
		expect(plan.categories.map((c: Json) => c.name)).toEqual(["Mercado", "Lazer"]);
		expect(plan.warnings.map((w: Json) => w.code)).toEqual(["scaled_to_fit"]);
		expect(plan.budget.byCategory[category("investimentos")]).toBeUndefined();
	});

	it("a reserva é configurável", async () => {
		const { api } = await ownerCase();
		const plan = (await api.get(`/v1/plan/${MONTH}?reservePercent=20`)).body;
		expect(plan.reservePercent).toBe(20);
		expect(plan.buckets.reserveCents).toBe(46000);
		expect(plan.budget.totalCents).toBe(184000);
		expect((await api.get(`/v1/plan/${MONTH}?reservePercent=101`)).status).toBe(400);
		expect((await api.get("/v1/plan/2026-13")).status).toBe(400);
	});

	it("inclui recorrências, parcelas da fatura do mês e as metas; compromissos não encolhem", async () => {
		const { api, account, card, category } = await ownerCase();
		await api.post("/v1/recurrences", {
			kind: "expense",
			name: "Aluguel",
			amountCents: 100000,
			dayOfMonth: 5,
			startDate: "2026-01-01",
			accountId: account.id,
			categoryId: category("moradia"),
		});
		const inst = await api.post("/v1/transactions/installments", {
			cardId: card.id,
			totalCents: 30000,
			count: 3,
			date: "2026-10-05",
			description: "TV",
			categoryId: category("lazer"),
		});
		const dueNow = inst.body.transactions.find((t: Json) => t.invoiceMonth === MONTH);
		expect(dueNow).toBeDefined();
		await api.post("/v1/goals", { name: "Viagem", targetCents: 120000, deadline: "2027-02-28" });

		const plan = (await api.get(`/v1/plan/${MONTH}`)).body;
		expect(plan.commitments.map((c: Json) => c.source).sort()).toEqual(["installment", "recurrence"]);
		const rent = plan.categories.find((c: Json) => c.categoryId === category("moradia"));
		expect(rent).toMatchObject({ commitmentsCents: 100000, dailyCents: 0, totalCents: 100000 });
		const tv = plan.commitments.find((c: Json) => c.source === "installment");
		expect(tv.amountCents).toBe(dueNow.amountCents);
		expect(plan.buckets.goalsCents).toBe(40000);
		expect(plan.budget.totalCents).toBeLessThanOrEqual(230000 - 23000 - 40000);
		expect(plan.budget.totalCents).toBe(sum(plan.budget.byCategory));
	});

	it("compromissos acima da renda: aviso e nenhum plano para aplicar", async () => {
		const { api, account, category } = await ownerCase();
		await api.post("/v1/recurrences", {
			kind: "expense",
			name: "Financiamento",
			amountCents: 260000,
			dayOfMonth: 10,
			startDate: "2026-01-01",
			accountId: account.id,
			categoryId: category("moradia"),
		});
		const plan = (await api.get(`/v1/plan/${MONTH}`)).body;
		expect(plan.feasible).toBe(false);
		expect(plan.budget).toEqual({ totalCents: 0, byCategory: {} });
		expect(plan.warnings[0]).toMatchObject({ code: "commitments_exceed_income", amountCents: 30000 });
		const apply = await api.post(`/v1/plan/${MONTH}/apply`, { confirm: true });
		expect(apply.status).toBe(400);
		expect((await api.get("/v1/budgets")).body.budgets).toEqual([]);
		// A sugestão também não inventa limites.
		const s = (await api.get("/v1/budgets/suggestion")).body;
		expect(s.totalCents).toBe(0);
		expect(s.warnings[0]).toContain("passam da renda");
	});

	it("sem renda: avisa para cadastrar", async () => {
		const { api } = await setupFinance();
		const plan = (await api.get(`/v1/plan/${MONTH}`)).body;
		expect(plan.feasible).toBe(false);
		expect(plan.warnings[0].code).toBe("no_income");
		expect((await api.post(`/v1/plan/${MONTH}/apply`, {})).status).toBe(400);
	});
});

describe("aplicar o plano ao orçamento", () => {
	it("grava total e categorias (soma = total), pede confirmação para trocar o que existe e desfaz", async () => {
		const { api, category } = await ownerCase();
		// O orçamento de hoje do dono: total 2.300, categorias somando mais, e R$ 738 em Investimentos.
		await api.put("/v1/budgets", { scope: "total", limitCents: 230000 });
		await api.put("/v1/budgets", { scope: category("mercado"), limitCents: 150000 });
		await api.put("/v1/budgets", { scope: category("lazer"), limitCents: 150000 });
		await api.put("/v1/budgets", { scope: category("investimentos"), limitCents: 73800 });

		const preview = (await api.get(`/v1/plan/${MONTH}`)).body;
		expect(preview.replacesCount).toBe(4);

		const blocked = await api.post(`/v1/plan/${MONTH}/apply`, {});
		expect(blocked.status).toBe(409);
		expect(blocked.body.error.message).toContain("4 limites");
		expect((await api.get("/v1/budgets")).body.budgets).toHaveLength(4);

		const applied = await api.post(`/v1/plan/${MONTH}/apply`, { confirm: true });
		expect(applied.status).toBe(200);
		const byScope = Object.fromEntries(applied.body.budgets.map((b: Json) => [b.scope, b.limitCents]));
		const { total, ...categories } = byScope;
		expect(total).toBe(207000);
		expect(sum(categories)).toBe(total);
		expect(categories[category("investimentos")]).toBeUndefined();
		expect(applied.body.previous).toContainEqual({ scope: category("investimentos"), limitCents: 73800 });

		// Desfazer devolve o orçamento de antes.
		const undo = await api.post("/v1/budgets/restore", { previous: applied.body.previous });
		expect(undo.status).toBe(204);
		const after = Object.fromEntries(
			(await api.get("/v1/budgets")).body.budgets.map((b: Json) => [b.scope, b.limitCents]),
		);
		expect(after).toEqual({
			total: 230000,
			[category("mercado")]: 150000,
			[category("lazer")]: 150000,
			[category("investimentos")]: 73800,
		});
	});

	it("sem limites antes não precisa de confirmação; aplicar de novo não troca nada", async () => {
		const { api } = await ownerCase();
		const first = await api.post(`/v1/plan/${MONTH}/apply`, {});
		expect(first.status).toBe(200);
		expect(first.body.previous.every((p: Json) => p.limitCents === null)).toBe(true);
		expect((await api.get(`/v1/plan/${MONTH}`)).body.replacesCount).toBe(0);
		expect((await api.post(`/v1/plan/${MONTH}/apply`, {})).status).toBe(200);
	});

	it("recusa aplicar o plano de um mês que já passou", async () => {
		const { api } = await ownerCase();
		const res = await api.post("/v1/plan/2026-10/apply", { confirm: true });
		expect(res.status).toBe(400);
		expect(res.body.error.message).toContain("mês atual ou de um mês futuro");
	});

	it("valida o corpo", async () => {
		const { api } = await ownerCase();
		expect((await api.post(`/v1/plan/${MONTH}/apply`, { reservePercent: 10.5 })).status).toBe(400);
		expect((await api.post(`/v1/plan/${MONTH}/apply`, { surpresa: true })).status).toBe(400);
	});
});

describe("Ajustar para caber", () => {
	it("reduz os limites das categorias até caberem no total, com a soma exata, e desfaz", async () => {
		const { api, category } = await setupFinance().then(async (t) => ({ ...t, ...(await t.basics()) }));
		await api.put("/v1/budgets", { scope: "total", limitCents: 230000 });
		await api.put("/v1/budgets", { scope: category("mercado"), limitCents: 150000 });
		await api.put("/v1/budgets", { scope: category("lazer"), limitCents: 127500 });
		const res = await api.post("/v1/budgets/fit");
		expect(res.status).toBe(200);
		const limits = res.body.budgets.filter((b: Json) => b.scope !== "total");
		expect(sum(Object.fromEntries(limits.map((b: Json) => [b.scope, b.limitCents])))).toBe(230000);
		expect(limits.find((b: Json) => b.scope === category("mercado")).limitCents).toBe(124324);
		expect(res.body.budgets.find((b: Json) => b.scope === "total").limitCents).toBe(230000);
		expect(res.body.previous).toHaveLength(2);

		await api.post("/v1/budgets/restore", { previous: res.body.previous });
		const back = (await api.get("/v1/budgets")).body.budgets;
		expect(back.find((b: Json) => b.scope === category("lazer")).limitCents).toBe(127500);
	});

	it("não encolhe o que já é compromisso (aluguel)", async () => {
		const { api, account, category } = await setupFinance().then(async (t) => ({
			...t,
			...(await t.basics()),
		}));
		await api.post("/v1/recurrences", {
			kind: "expense",
			name: "Aluguel",
			amountCents: 100000,
			dayOfMonth: 5,
			startDate: "2026-01-01",
			accountId: account.id,
			categoryId: category("moradia"),
		});
		await api.put("/v1/budgets", { scope: "total", limitCents: 200000 });
		await api.put("/v1/budgets", { scope: category("moradia"), limitCents: 100000 });
		await api.put("/v1/budgets", { scope: category("mercado"), limitCents: 200000 });
		const res = await api.post("/v1/budgets/fit");
		const by = Object.fromEntries(res.body.budgets.map((b: Json) => [b.scope, b.limitCents]));
		expect(by[category("moradia")]).toBe(100000);
		expect(by[category("mercado")]).toBe(100000);
	});

	it("já cabendo, não muda nada; sem total, explica", async () => {
		const { api, category } = await setupFinance().then(async (t) => ({ ...t, ...(await t.basics()) }));
		expect((await api.post("/v1/budgets/fit")).status).toBe(400);
		await api.put("/v1/budgets", { scope: "total", limitCents: 230000 });
		await api.put("/v1/budgets", { scope: category("mercado"), limitCents: 100000 });
		const res = await api.post("/v1/budgets/fit");
		expect(res.status).toBe(200);
		expect(res.body.previous).toEqual([]);
	});
});
