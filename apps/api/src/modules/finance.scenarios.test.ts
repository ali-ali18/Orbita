import { describe, expect, it } from "vitest";
import { setupFinance } from "../test-support.ts";

// "Hoje" = 15/11/2026: faltam 16 dias do mês contando hoje.

async function withRent() {
	const ctx = await setupFinance();
	const b = await ctx.basics();
	await ctx.api.put("/v1/budgets", { scope: "total", limitCents: 500000 });
	const rent = (
		await ctx.api.post("/v1/recurrences", {
			kind: "expense",
			name: "Aluguel",
			amountCents: 150000,
			dayOfMonth: 5,
			startDate: "2026-01-01",
			accountId: b.account.id,
			categoryId: b.category("moradia"),
		})
	).body.recurrence;
	await ctx.api.post("/v1/transactions", {
		kind: "expense",
		amountCents: 20000,
		date: "2026-11-08",
		description: "Mercado",
		accountId: b.account.id,
		categoryId: b.category("mercado"),
	});
	return { ...ctx, ...b, rent };
}

describe("dá pra gastar", () => {
	it("aluguel já lançado não é reservado de novo", async () => {
		const { api, rent } = await withRent();
		const before = (await api.get("/v1/summary/2026-11")).body;
		expect(before.pendingRecurring).toEqual({ expenseCents: 150000, incomeCents: 0 });
		expect(before.safeToSpend.availableCents).toBe(500000 - 20000 - 150000);
		expect(before.projection.projectedCents).toBe(190000);

		await api.post(`/v1/recurrences/${rent.id}/post`, { month: "2026-11" });
		const after = (await api.get("/v1/summary/2026-11")).body;
		expect(after.pendingRecurring).toEqual({ expenseCents: 0, incomeCents: 0 });
		expect(after.summary.spentCents).toBe(170000);
		// Mesmo disponível: o gasto subiu 150.000 e a reserva caiu 150.000 (nada em dobro).
		expect(after.safeToSpend).toEqual({ availableCents: 330000, perDayCents: 20625, remainingDays: 16 });
		// Ritmo variável só olha o mercado, não o aluguel.
		expect(after.projection).toEqual({ projectedCents: 190000, lowConfidence: false });
	});

	it("salário recorrente nunca é reservado como gasto", async () => {
		const { api, account } = await withRent();
		const salary = (
			await api.post("/v1/recurrences", {
				kind: "income",
				name: "Salário",
				amountCents: 800000,
				dayOfMonth: 5,
				startDate: "2026-01-01",
				accountId: account.id,
			})
		).body.recurrence;
		const before = (await api.get("/v1/summary/2026-11")).body;
		expect(before.pendingRecurring).toEqual({ expenseCents: 150000, incomeCents: 800000 });
		expect(before.safeToSpend.availableCents).toBe(330000);
		await api.post(`/v1/recurrences/${salary.id}/post`, { month: "2026-11" });
		const after = (await api.get("/v1/summary/2026-11")).body;
		expect(after.summary.incomeCents).toBe(800000);
		expect(after.summary.spentCents).toBe(20000);
		expect(after.safeToSpend.availableCents).toBe(330000);
	});

	it("mês fora do atual só mostra totais; sem orçamento total não há 'dá pra gastar'", async () => {
		const { api } = await setupFinance();
		const past = (await api.get("/v1/summary/2026-10")).body;
		expect(past.safeToSpend).toBeNull();
		expect(past.projection).toBeNull();
		await api.put("/v1/budgets", { scope: "total", limitCents: 0 });
		const cur = (await api.get("/v1/summary/2026-11")).body;
		expect(cur.safeToSpend.availableCents).toBe(0);
		const { account } = await api.post("/v1/accounts", { name: "C", kind: "checking" }).then((r) => r.body);
		await api.post("/v1/transactions", {
			kind: "expense",
			amountCents: 100,
			date: "2026-11-01",
			description: "x",
			accountId: account.id,
		});
		const over = (await api.get("/v1/summary/2026-11")).body.budgets[0];
		expect(over).toMatchObject({ scope: "total", overBudget: true, ratio: null, remainingCents: -100 });
	});
});

describe("parcelado", () => {
	it("1.200 em 12x pesa 100 no mês da compra; cada fatura mostra a sua parcela", async () => {
		const { api, card } = await withRent();
		await api.post("/v1/transactions/installments", {
			cardId: card.id,
			totalCents: 120000,
			count: 12,
			date: "2026-11-15",
			description: "Geladeira",
		});

		// 20.000 do mercado + 10.000 da primeira parcela.
		expect((await api.get("/v1/summary/2026-11")).body.summary.spentCents).toBe(30000);
		expect((await api.get("/v1/summary/2026-12")).body.summary.spentCents).toBe(10000);

		const dec = (await api.get(`/v1/cards/${card.id}/invoices/2026-12`)).body;
		expect(dec.composition).toEqual({
			purchasesCents: 0,
			installmentsCents: 10000,
			recurringCents: 0,
			refundsCents: 0,
			totalCents: 10000,
		});
		expect(dec.transactions.map((t: { installmentNumber: number }) => t.installmentNumber)).toEqual([1]);
		expect(dec.invoice).toMatchObject({ month: "2026-12", dueDate: "2026-12-20", status: "open" });
		const jan = (await api.get(`/v1/cards/${card.id}/invoices/2027-01`)).body;
		expect(jan.transactions.map((t: { installmentNumber: number }) => t.installmentNumber)).toEqual([2]);

		const nov = (await api.get(`/v1/cards/${card.id}/invoices/2026-11`)).body;
		expect(nov.invoice.status).toBe("closed");

		const inst = (await api.get("/v1/installments?from=2027-02")).body;
		expect(inst.groups).toHaveLength(1);
		expect(inst.groups[0]).toMatchObject({
			count: 12,
			totalCents: 120000,
			paidCount: 2,
			paidCents: 20000,
			remainingCount: 10,
			remainingCents: 100000,
		});
		expect((await api.get("/v1/installments?from=2028-01")).body.groups).toHaveLength(0);
		expect((await api.get("/v1/installments")).body.from).toBe("2026-11");
	});

	it("composição separa compras, recorrência e estornos", async () => {
		const { api, card } = await withRent();
		const stream = (
			await api.post("/v1/recurrences", {
				kind: "expense",
				name: "Streaming",
				amountCents: 3000,
				dayOfMonth: 15,
				startDate: "2026-01-01",
				cardId: card.id,
			})
		).body.recurrence;
		await api.post(`/v1/recurrences/${stream.id}/post`, { month: "2026-11" });
		const buy = (
			await api.post("/v1/transactions", {
				kind: "expense",
				amountCents: 10000,
				date: "2026-11-12",
				description: "Loja",
				cardId: card.id,
			})
		).body.transaction;
		await api.post("/v1/transactions", {
			kind: "refund",
			amountCents: 2500,
			date: "2026-11-13",
			description: "Devolução",
			cardId: card.id,
			refundOfId: buy.id,
		});
		const inv = (await api.get(`/v1/cards/${card.id}/invoices/2026-12`)).body;
		expect(inv.composition).toEqual({
			purchasesCents: 10000,
			installmentsCents: 0,
			recurringCents: 3000,
			refundsCents: 2500,
			totalCents: 10500,
		});
		expect((await api.get(`/v1/cards/nao-existe/invoices/2026-12`)).status).toBe(404);
	});
});

describe("fatura paga", () => {
	// Cartão fecha dia 10 e vence dia 20; hoje = 15/11/2026. A fatura 2026-11 fechou 10/11 e vence 20/11.
	async function withNovInvoice() {
		const ctx = await withRent();
		await ctx.api.post("/v1/transactions", {
			kind: "expense",
			amountCents: 100_000,
			date: "2026-10-20",
			description: "TV",
			cardId: ctx.card.id,
		});
		const pay = (amountCents: number, date: string) =>
			ctx.api.post("/v1/transactions", {
				kind: "card_payment",
				amountCents,
				date,
				description: "Fatura",
				accountId: ctx.account.id,
				cardId: ctx.card.id,
			});
		const inv = async (month: string) =>
			(await ctx.api.get(`/v1/cards/${ctx.card.id}/invoices/${month}`)).body.invoice;
		return { ...ctx, pay, inv };
	}

	it("sem pagamento: fechada e não paga; a do mês seguinte segue aberta", async () => {
		const { inv } = await withNovInvoice();
		expect(await inv("2026-11")).toMatchObject({ status: "closed", paidCents: 0, paymentStatus: "unpaid" });
		expect(await inv("2026-12")).toMatchObject({ status: "open", paidCents: 0, paymentStatus: "open" });
	});

	it("paga em parte e depois por inteiro", async () => {
		const { pay, inv } = await withNovInvoice();
		await pay(40_000, "2026-11-12");
		expect(await inv("2026-11")).toMatchObject({ paidCents: 40_000, paymentStatus: "partial" });
		await pay(60_000, "2026-11-14");
		expect(await inv("2026-11")).toMatchObject({ paidCents: 100_000, paymentStatus: "paid" });
	});

	it("pagamento só conta na fatura a que pertence (o do ciclo seguinte não paga esta)", async () => {
		const { pay, inv } = await withNovInvoice();
		await pay(100_000, "2026-12-10"); // depois do fechamento de dezembro: é da fatura de dezembro
		expect(await inv("2026-11")).toMatchObject({ paidCents: 0, paymentStatus: "unpaid" });
		expect((await inv("2026-12")).paidCents).toBe(100_000);
	});

	it("pagamento de outro cartão não conta", async () => {
		const { api, pay, inv, account } = await withNovInvoice();
		const other = (await api.post("/v1/cards", { name: "Outro", closingDay: 10, dueDay: 20 })).body.card;
		await api.post("/v1/transactions", {
			kind: "card_payment",
			amountCents: 100_000,
			date: "2026-11-12",
			description: "Fatura",
			accountId: account.id,
			cardId: other.id,
		});
		await pay(1_000, "2026-11-12");
		expect(await inv("2026-11")).toMatchObject({ paidCents: 1_000, paymentStatus: "partial" });
	});
});

describe("estorno, pagamento de fatura e transferência", () => {
	it("estorno de compra do mês passado abate a categoria da compra original", async () => {
		const { api, account, category } = await withRent();
		const old = (
			await api.post("/v1/transactions", {
				kind: "expense",
				amountCents: 30000,
				date: "2026-10-20",
				description: "Mercado",
				accountId: account.id,
				categoryId: category("mercado"),
			})
		).body.transaction;
		await api.post("/v1/transactions", {
			kind: "expense",
			amountCents: 8000,
			date: "2026-11-09",
			description: "Pizza",
			accountId: account.id,
			categoryId: category("delivery"),
		});
		await api.post("/v1/transactions", {
			kind: "refund",
			amountCents: 10000,
			date: "2026-11-10",
			description: "Estorno",
			accountId: account.id,
			refundOfId: old.id,
		});
		const s = (await api.get("/v1/summary/2026-11")).body;
		expect(s.summary.byCategory[category("mercado")]).toBe(10000);
		expect(s.summary.byCategory[category("delivery")]).toBe(8000);
		expect(s.summary.spentCents).toBe(18000);
		expect(s.refundCreditCents).toBe(0);
		// Outubro não muda retroativamente.
		expect((await api.get("/v1/summary/2026-10")).body.summary.spentCents).toBe(30000);
	});

	it("estorno maior que o gasto da categoria vira crédito", async () => {
		const { api, account, category } = await setupFinance().then(async (c) => ({
			...c,
			...(await c.basics()),
		}));
		const old = (
			await api.post("/v1/transactions", {
				kind: "expense",
				amountCents: 30000,
				date: "2026-10-20",
				description: "M",
				accountId: account.id,
				categoryId: category("mercado"),
			})
		).body.transaction;
		await api.post("/v1/transactions", {
			kind: "refund",
			amountCents: 10000,
			date: "2026-11-10",
			description: "E",
			accountId: account.id,
			refundOfId: old.id,
		});
		const s = (await api.get("/v1/summary/2026-11")).body;
		expect(s.summary.spentCents).toBe(0);
		expect(s.refundCreditCents).toBe(10000);
	});

	it("pagamento de fatura e transferência não contam como gasto", async () => {
		const { api, account, card, category } = await withRent();
		const other = (await api.post("/v1/accounts", { name: "Poupança", kind: "savings" })).body.account;
		await api.post("/v1/transactions", {
			kind: "expense",
			amountCents: 7000,
			date: "2026-11-10",
			description: "Loja",
			cardId: card.id,
			categoryId: category("lazer"),
		});
		await api.post("/v1/transactions", {
			kind: "card_payment",
			amountCents: 50000,
			date: "2026-11-12",
			description: "Fatura",
			cardId: card.id,
			accountId: account.id,
		});
		await api.post("/v1/transactions", {
			kind: "transfer",
			amountCents: 30000,
			date: "2026-11-13",
			description: "Reserva",
			accountId: account.id,
			counterpartAccountId: other.id,
		});
		const s = (await api.get("/v1/summary/2026-11")).body;
		expect(s.summary.spentCents).toBe(27000);
		expect(s.safeToSpend.availableCents).toBe(500000 - 27000 - 150000);
		const inv = (await api.get(`/v1/cards/${card.id}/invoices/2026-12`)).body;
		expect(inv.composition.totalCents).toBe(7000);
	});

	it("gasto sem categoria entra na categoria Outros e conta no orçamento dela", async () => {
		const { api, account, category } = await setupFinance().then(async (c) => ({
			...c,
			...(await c.basics()),
		}));
		await api.put("/v1/budgets", { scope: category("outros"), limitCents: 5000 });
		await api.post("/v1/transactions", {
			kind: "expense",
			amountCents: 6000,
			date: "2026-11-10",
			description: "?",
			accountId: account.id,
		});
		const s = (await api.get("/v1/summary/2026-11")).body;
		expect(s.summary.byCategory[category("outros")]).toBe(6000);
		expect(s.budgets[0]).toMatchObject({ spentCents: 6000, overBudget: true });
	});

	it("texto do banco tira o gasto de Outros; PIX sem palavra continua lá", async () => {
		const { api, account, category } = await setupFinance().then(async (c) => ({
			...c,
			...(await c.basics()),
		}));
		await api.post("/v1/transactions", {
			kind: "expense",
			amountCents: 4890,
			date: "2026-11-10",
			description: "Pix enviado - iFood",
			accountId: account.id,
			categoryId: category("outros"),
		});
		await api.post("/v1/transactions", {
			kind: "expense",
			amountCents: 1500,
			date: "2026-11-11",
			description: "Pix enviado - Rei Dos",
			accountId: account.id,
			categoryId: category("outros"),
		});
		const s = (await api.get("/v1/summary/2026-11")).body;
		expect(s.summary.byCategory[category("delivery")]).toBe(4890);
		expect(s.summary.byCategory[category("outros")]).toBe(1500);
		expect(s.summary.spentCents).toBe(6390);
	});
});

describe("segurança e erros", () => {
	it("toda rota de finanças dá 401 sem token (e com token falso)", async () => {
		const { call } = await setupFinance();
		const routes: [string, string][] = [
			["GET", "/v1/accounts"],
			["POST", "/v1/accounts"],
			["GET", "/v1/accounts/x"],
			["PATCH", "/v1/accounts/x"],
			["DELETE", "/v1/accounts/x"],
			["GET", "/v1/cards"],
			["POST", "/v1/cards"],
			["GET", "/v1/cards/x"],
			["PATCH", "/v1/cards/x"],
			["DELETE", "/v1/cards/x"],
			["GET", "/v1/categories"],
			["POST", "/v1/categories"],
			["GET", "/v1/category-rules"],
			["POST", "/v1/category-rules"],
			["DELETE", "/v1/category-rules/x"],
			["GET", "/v1/categories/x"],
			["PATCH", "/v1/categories/x"],
			["DELETE", "/v1/categories/x"],
			["GET", "/v1/budgets"],
			["PUT", "/v1/budgets"],
			["DELETE", "/v1/budgets/total"],
			["GET", "/v1/recurrences"],
			["POST", "/v1/recurrences"],
			["GET", "/v1/recurrences/x"],
			["PATCH", "/v1/recurrences/x"],
			["DELETE", "/v1/recurrences/x"],
			["POST", "/v1/recurrences/x/post"],
			["GET", "/v1/transactions"],
			["POST", "/v1/transactions"],
			["POST", "/v1/transactions/installments"],
			["GET", "/v1/transactions/pending"],
			["GET", "/v1/transactions/month/2026-11"],
			["GET", "/v1/transactions/x"],
			["PATCH", "/v1/transactions/x"],
			["DELETE", "/v1/transactions/x"],
			["POST", "/v1/transactions/x/confirm"],
			["GET", "/v1/summary/2026-11"],
			["GET", "/v1/cards/x/invoices/2026-11"],
			["GET", "/v1/installments"],
		];
		for (const [method, path] of routes) {
			const body = method === "GET" || method === "DELETE" ? undefined : {};
			expect((await call(method, path, body, null)).status, `${method} ${path}`).toBe(401);
			expect((await call(method, path, body, "orb_falso")).status, `${method} ${path} (falso)`).toBe(401);
		}
	});

	it("DataError vira 409 (duplicado) e 422 (conta arquivada) sem vazar detalhe", async () => {
		const { api, account } = await withRent();
		const rent = (await api.get("/v1/recurrences")).body.recurrences[0];
		await api.post(`/v1/recurrences/${rent.id}/post`, { month: "2026-11" });
		const dup = await api.post(`/v1/recurrences/${rent.id}/post`, { month: "2026-11" });
		expect(dup.status).toBe(409);
		expect(dup.body.error.code).toBe("conflito");

		await api.delete(`/v1/accounts/${account.id}`);
		const archived = await api.post("/v1/transactions", {
			kind: "expense",
			amountCents: 100,
			date: "2026-11-10",
			description: "x",
			accountId: account.id,
		});
		expect(archived.status).toBe(422);
		expect(archived.body.error).toEqual({
			code: "referencia_invalida",
			message: "A conta informada está arquivada.",
		});
		expect(JSON.stringify(archived.body)).not.toMatch(/prisma|select|stack/i);
	});
});
