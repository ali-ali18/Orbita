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
	it("1.200 em 12x pesa 100 em cada mês de fatura; cada fatura mostra a sua parcela", async () => {
		const { api, card } = await withRent();
		await api.post("/v1/transactions/installments", {
			cardId: card.id,
			totalCents: 120000,
			count: 12,
			date: "2026-11-15",
			description: "Geladeira",
		});

		// Cartão pesa na fatura: a primeira parcela vence em dezembro, então novembro fica só com os 20.000 do mercado.
		expect((await api.get("/v1/summary/2026-11")).body.summary.spentCents).toBe(20000);
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

describe("marcar fatura como paga", () => {
	// Mesmo cenário de "fatura paga": a fatura 2026-11 (R$ 1.000,00) fechou 10/11; hoje = 15/11/2026.
	async function withNovInvoice() {
		const ctx = await withRent();
		await ctx.api.post("/v1/transactions", {
			kind: "expense",
			amountCents: 100_000,
			date: "2026-10-20",
			description: "TV",
			cardId: ctx.card.id,
		});
		const payUrl = (month: string) => `/v1/cards/${ctx.card.id}/invoices/${month}/pay`;
		const inv = async (month: string) =>
			(await ctx.api.get(`/v1/cards/${ctx.card.id}/invoices/${month}`)).body.invoice;
		return { ...ctx, payUrl, inv };
	}

	it("paga o total da fatura fechada, da conta escolhida, e a fatura passa a paga", async () => {
		const { api, account, card, payUrl, inv } = await withNovInvoice();
		const res = await api.post(payUrl("2026-11"), { accountId: account.id });
		expect(res.status).toBe(201);
		expect(res.body.transaction).toMatchObject({
			kind: "card_payment",
			amountCents: 100_000,
			date: "2026-11-15",
			accountId: account.id,
			cardId: card.id,
		});
		expect(await inv("2026-11")).toMatchObject({ paidCents: 100_000, paymentStatus: "paid" });
	});

	it("paga só o que falta quando já houve pagamento em parte", async () => {
		const { api, account, card, payUrl, inv } = await withNovInvoice();
		await api.post("/v1/transactions", {
			kind: "card_payment",
			amountCents: 40_000,
			date: "2026-11-12",
			description: "Fatura",
			accountId: account.id,
			cardId: card.id,
		});
		const res = await api.post(payUrl("2026-11"), { accountId: account.id });
		expect(res.body.transaction.amountCents).toBe(60_000);
		expect(await inv("2026-11")).toMatchObject({ paidCents: 100_000, paymentStatus: "paid" });
	});

	it("Desfazer: apagar o pagamento devolve a fatura a não paga", async () => {
		const { api, account, payUrl, inv } = await withNovInvoice();
		const { transaction } = (await api.post(payUrl("2026-11"), { accountId: account.id })).body;
		expect((await api.delete(`/v1/transactions/${transaction.id}`)).status).toBe(200);
		expect(await inv("2026-11")).toMatchObject({ paidCents: 0, paymentStatus: "unpaid" });
	});

	it("não paga duas vezes: a segunda tentativa é conflito e nada é criado", async () => {
		const { api, account, payUrl, inv } = await withNovInvoice();
		await api.post(payUrl("2026-11"), { accountId: account.id });
		const again = await api.post(payUrl("2026-11"), { accountId: account.id });
		expect(again.status).toBe(409);
		expect(again.body.error.message).toBe("A fatura já está paga.");
		expect((await inv("2026-11")).paidCents).toBe(100_000);
	});

	it("recusa fatura ainda aberta, conta que não existe e corpo inválido", async () => {
		const { api, account, payUrl } = await withNovInvoice();
		const open = await api.post(payUrl("2026-12"), { accountId: account.id });
		expect(open.status).toBe(400);
		expect(open.body.error.message).toBe(
			"A fatura ainda está aberta: só dá para pagar depois que ela fecha.",
		);
		expect((await api.post(payUrl("2026-11"), { accountId: "nao-existe" })).status).toBe(404);
		expect((await api.post(payUrl("2026-11"), {})).status).toBe(400);
		expect((await api.post(payUrl("2026-11"), { accountId: account.id, amountCents: 1 })).status).toBe(400);
	});

	it("fatura antiga: o pagamento cai na janela dela, não na da fatura seguinte", async () => {
		const { api, account, card, payUrl, inv } = await withNovInvoice();
		// A fatura de outubro (compra de 20/09) fechou 10/10; hoje (15/11) já é da janela de novembro.
		await api.post("/v1/transactions", {
			kind: "expense",
			amountCents: 30_000,
			date: "2026-09-20",
			description: "Geladeira",
			cardId: card.id,
		});
		const res = await api.post(payUrl("2026-10"), { accountId: account.id });
		expect(res.status).toBe(201);
		expect(res.body.transaction.date).toBe("2026-11-09");
		expect(await inv("2026-10")).toMatchObject({ paidCents: 30_000, paymentStatus: "paid" });
		expect(await inv("2026-11")).toMatchObject({ paidCents: 0, paymentStatus: "unpaid" });
	});

	it("o mesmo Idempotency-Key devolve o pagamento já feito em vez de repetir", async () => {
		const { app, token, account, payUrl, inv } = await withNovInvoice();
		const send = async () => {
			const res = await app.request(payUrl("2026-11"), {
				method: "POST",
				headers: {
					authorization: `Bearer ${token}`,
					"content-type": "application/json",
					"idempotency-key": "7b1f1c0e-5d9a-4f55-9b0e-3a2c8d1e4f10",
				},
				body: JSON.stringify({ accountId: account.id }),
			});
			return { status: res.status, body: (await res.json()) as { transaction: { id: string } } };
		};
		const first = await send();
		const second = await send();
		expect(second.status).toBe(201);
		expect(second.body.transaction.id).toBe(first.body.transaction.id);
		expect((await inv("2026-11")).paidCents).toBe(100_000);
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
		// A compra de 7.000 no cartão vence em dezembro: não pesa em novembro.
		expect(s.summary.spentCents).toBe(20000);
		expect(s.safeToSpend.availableCents).toBe(500000 - 20000 - 150000);
		expect((await api.get("/v1/summary/2026-12")).body.summary.spentCents).toBe(7000);
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

	it("texto do banco tira o gasto de Outros; PIX sem compra vira Transferências", async () => {
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
		expect(s.summary.byCategory[category("transferencias")]).toBe(1500);
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

describe("gastos por categoria: rendimento, fatura paga e transferência própria não são gasto", () => {
	it("Início, orçamento e total fecham só com as despesas", async () => {
		const ctx = await setupFinance();
		const b = await ctx.basics();
		const other = (await ctx.api.post("/v1/accounts", { name: "Mercado Pago", kind: "checking" })).body
			.account;
		await ctx.api.put("/v1/budgets", { scope: "total", limitCents: 200_000 });
		const post = (body: Record<string, unknown>) => ctx.api.post("/v1/transactions", body);
		const expense = (amountCents: number, date: string, categoryId: string, extra: object = {}) =>
			post({
				kind: "expense",
				amountCents,
				date,
				description: "x",
				categoryId,
				accountId: b.account.id,
				...extra,
			});

		await expense(25_000, "2026-11-03", b.category("mercado"));
		await expense(9_000, "2026-11-06", b.category("transferencias"), {
			description: "Pix enviado - Rei Dos Coins",
		});
		await expense(20_000, "2026-11-07", b.category("investimentos"), { description: "Aplicação" });
		await expense(83_010, "2026-11-05", b.category("lazer"), { accountId: undefined, cardId: b.card.id });
		await post({
			kind: "income",
			amountCents: 320,
			date: "2026-11-08",
			description: "Rendimentos",
			categoryId: b.category("investimentos"),
			accountId: other.id,
		});
		await post({
			kind: "card_payment",
			amountCents: 83_010,
			date: "2026-11-09",
			description: "Pagamento de fatura",
			accountId: b.account.id,
			cardId: b.card.id,
		});
		await post({
			kind: "transfer",
			amountCents: 50_000,
			date: "2026-11-10",
			description: "Para o Mercado Pago",
			categoryId: b.category("transferencias"),
			accountId: b.account.id,
			counterpartAccountId: other.id,
		});

		// Pix de/para outra conta sua, sem saber qual: transferência sem destino, nos dois sentidos.
		for (const description of ["Pix enviado - titular", "Pix recebido - titular"]) {
			const res = await post({
				kind: "transfer",
				amountCents: 70_000,
				date: "2026-11-11",
				description,
				categoryId: b.category("transferencias"),
				accountId: b.account.id,
			});
			expect(res.status).toBe(201);
		}

		const body = (await ctx.api.get("/v1/summary/2026-11")).body;
		expect(body.summary.byCategory).toEqual({
			[b.category("mercado")]: 25_000,
			[b.category("transferencias")]: 9_000,
			[b.category("investimentos")]: 20_000,
			[b.category("lazer")]: 83_010,
		});
		expect(body.summary.spentCents).toBe(137_010);
		expect(body.summary.incomeCents).toBe(320);
		const total = body.budgets.find((x: { scope: string }) => x.scope === "total");
		expect(total).toMatchObject({ spentCents: 137_010, remainingCents: 62_990, overBudget: false });
		expect(total.ratio).toBeCloseTo(0.68505, 5);
	});
});

describe("gasto por fatura e investido (caso do dono)", () => {
	/** Cartão fecha dia 10 e vence dia 20; "hoje" = 15/11: a fatura de novembro está fechada, a de dezembro aberta. */
	async function ownerCase() {
		const ctx = await withRent();
		const { api, card, account, category } = ctx;
		// 3x de 86,87: parcela 1 em setembro, 2 em outubro, 3 em novembro.
		await api.post("/v1/transactions/installments", {
			cardId: card.id,
			totalCents: 26061,
			count: 3,
			date: "2026-09-05",
			description: "Notebook",
			categoryId: category("lazer"),
		});
		const buy = (amountCents: number, date: string, description: string, slug: string) =>
			api.post("/v1/transactions", {
				kind: "expense",
				amountCents,
				date,
				description,
				cardId: card.id,
				categoryId: category(slug),
			});
		await buy(12464, "2026-11-02", "Farmácia", "saude"); // fatura de novembro
		await buy(51000, "2026-10-30", "Tênis", "lazer"); // comprada em outubro, mas vence em novembro
		await buy(5150, "2026-11-12", "Padaria", "mercado"); // fatura aberta: vence em dezembro
		await api.post("/v1/transactions", {
			kind: "investment",
			amountCents: 200000,
			date: "2026-11-04",
			description: "Aplicação CDB",
			accountId: account.id,
			categoryId: category("investimentos"),
		});
		await api.post("/v1/transactions", {
			kind: "income",
			amountCents: 1234,
			date: "2026-11-06",
			description: "Rendimento CDB",
			accountId: account.id,
			categoryId: category("investimentos"),
		});
		return ctx;
	}

	it("novembro soma a fatura que vence nele (86,87 + 124,64 + 510,00) mais a conta; investido à parte", async () => {
		const { api, category } = await ownerCase();
		const nov = (await api.get("/v1/summary/2026-11")).body;
		// 20.000 de mercado na conta + 8.687 + 12.464 + 51.000 da fatura fechada. A aplicação e a fatura aberta ficam fora.
		expect(nov.summary.spentCents).toBe(20000 + 8687 + 12464 + 51000);
		expect(nov.summary.investedCents).toBe(200000);
		expect(nov.summary.incomeCents).toBe(1234);
		expect(nov.summary.projectedCents).toBe(0);
		expect(nov.summary.byCategory[category("investimentos")]).toBeUndefined();
		expect(nov.summary.byCategory[category("lazer")]).toBe(8687 + 51000);
		expect(nov.summary.byCategory[category("saude")]).toBe(12464);
		// Dá pra gastar = orçamento − gasto − recorrência pendente; o investido não reduz.
		expect(nov.safeToSpend.availableCents).toBe(500000 - (20000 + 72151) - 150000);
		// O ritmo diário só olha o que saiu da conta no dia a dia (a fatura é compromisso fechado).
		expect(nov.projection.projectedCents).toBe(
			20000 + 72151 + 150000 + 20000 /* 20.000 em 15 dias, mais 15 dias pela frente */,
		);
		const total = nov.budgets.find((b: { scope: string }) => b.scope === "total");
		expect(total.spentCents).toBe(20000 + 72151);
	});

	it("dezembro recebe a fatura aberta; o relatório de novembro bate com o Início", async () => {
		const { api } = await ownerCase();
		expect((await api.get("/v1/summary/2026-12")).body.summary.spentCents).toBe(5150);
		const report = (await api.get("/v1/reports/2026-11")).body;
		const home = (await api.get("/v1/summary/2026-11")).body;
		expect(report.totals.spentCents).toBe(home.summary.spentCents);
		expect(report.totals.investedCents).toBe(200000);
		expect(report.biggestExpenses[0]).toMatchObject({ description: "Tênis", amountCents: 51000 });
		expect((await api.get("/v1/reports")).body.months).toEqual(["2026-12", "2026-11", "2026-10", "2026-09"]);
	});

	it("com os quatro itens de cartão vencendo no mês, o gasto é 773,01", async () => {
		const { api, card, category } = await withRent();
		const buy = (amountCents: number, date: string, slug: string) =>
			api.post("/v1/transactions", {
				kind: "expense",
				amountCents,
				date,
				description: `x${amountCents}`,
				cardId: card.id,
				categoryId: category(slug),
			});
		// Todas na fatura que vence em 20/11 (compras até 9/11 e as de antes de 10/10 não entram nela).
		await buy(8687, "2026-10-20", "lazer");
		await buy(12464, "2026-10-25", "saude");
		await buy(51000, "2026-10-30", "lazer");
		await buy(5150, "2026-11-02", "mercado");
		const nov = (await api.get("/v1/summary/2026-11")).body;
		expect(nov.summary.spentCents - 20000).toBe(77301);
	});

	it("parcela que o banco ainda não lançou entra na fatura do mês, marcada como estimada", async () => {
		const { api, stores, card } = await withRent();
		const base = {
			kind: "expense" as const,
			amountCents: 5150,
			description: "Kabum",
			cardId: card.id,
			source: undefined,
		};
		for (const [n, date, invoiceMonth] of [
			[1, "2026-10-02", "2026-10"],
			[2, "2026-10-02", "2026-11"],
		] as const) {
			const { source: _s, ...input } = base;
			await stores.transactions.upsertInstallmentByExternal(
				"pluggy",
				`k-${n}`,
				{ ...input, date, invoiceMonth, budgetMonth: invoiceMonth },
				{ groupId: "kabum", number: n, count: 10 },
			);
		}
		const dec = (await api.get("/v1/summary/2026-12")).body.summary;
		expect(dec.spentCents).toBe(5150);
		expect(dec.projectedCents).toBe(5150);
		// Mês que já passou não ganha parcela inventada.
		expect((await api.get("/v1/summary/2026-09")).body.summary.projectedCents).toBe(0);
		// Novembro já tem a parcela 2 lançada: nada estimado.
		expect((await api.get("/v1/summary/2026-11")).body.summary.projectedCents).toBe(0);
	});
});
