import {
	accountBalancesResponse,
	cardLimitDto,
	cashFlowResponse,
	invoiceHistoryPointDto,
	limitsTotalDto,
	spendingDailyResponse,
} from "@orbita/shared";
import { describe, expect, it } from "vitest";
import { setupFinance } from "../test-support.ts";

// Hoje: 15/11/2026 (ver `NOW` em test-support).
describe("leituras com os números do banco", () => {
	it("GET /v1/invoices/overview: limite do banco (números reais do dono), total e série de 6 meses", async () => {
		const { api, stores } = await setupFinance();
		const real: [string, number, number][] = [
			["Nubank", 577000, 523267],
			["Inter", 290000, 256144],
			["Itaú", 566000, 535100],
			["Santander", 700000, 613130],
		];
		for (const [name, limitCents, availableCents] of real) {
			const card = (await api.post("/v1/cards", { name, closingDay: 10, dueDay: 20, limitCents })).body.card;
			await stores.cards.recordAvailable(card.id, availableCents, new Date("2026-11-15T14:00:00Z"));
		}
		const res = await api.get("/v1/invoices/overview");
		expect(res.status).toBe(200);
		expect(limitsTotalDto.parse(res.body.limits)).toMatchObject({
			limitCents: 2133000,
			usedCents: 205359,
			availableCents: 1927641,
		});
		const used = res.body.cards.map((c: { limit: unknown }) => cardLimitDto.parse(c.limit).usedCents);
		expect(used.sort((a: number, b: number) => a - b)).toEqual([30900, 33856, 53733, 86870]);
		expect(res.body.history).toHaveLength(6);
		for (const h of res.body.history) invoiceHistoryPointDto.parse(h);
		expect(res.body.cards[0].due).toMatchObject({ state: expect.any(String), source: "ledger" });
	});

	it("fatura fechada do banco: total do banco, situação e o bloco `bank` do detalhe", async () => {
		const { api, stores } = await setupFinance();
		const card = (await api.post("/v1/cards", { name: "Cartão", closingDay: 10, dueDay: 20 })).body.card;
		await stores.bills.upsert({
			cardId: card.id,
			source: "pluggy",
			externalId: "b-nov",
			dueDate: "2026-11-20",
			closeDate: "2026-11-10",
			totalAmountCents: 72151,
			syncedAt: new Date("2026-11-15T14:00:00Z"),
		});
		const overview = (await api.get("/v1/invoices/overview")).body;
		expect(overview.cards[0].due).toMatchObject({
			month: "2026-11",
			totalCents: 72151,
			source: "bank",
			state: "closed",
		});
		expect(overview.owedCents).toBe(72151);
		const detail = (await api.get(`/v1/cards/${card.id}/invoices/2026-11`)).body;
		expect(detail.bank).toMatchObject({ totalCents: 72151, dueDate: "2026-11-20" });
		const open = (await api.get(`/v1/cards/${card.id}/invoices/2026-12`)).body;
		expect(open.bank).toBeNull();
	});

	it("GET /v1/accounts/balances (antes de /:id) e GET /v1/cash-flow/:month", async () => {
		const { api, stores } = await setupFinance();
		const mp = (await api.post("/v1/accounts", { name: "Mercado Pago", kind: "checking" })).body.account;
		await api.post("/v1/accounts", { name: "Carteira", kind: "wallet" });
		await stores.accounts.recordBalance(mp.id, 20535, new Date("2026-11-15T14:00:00Z"));
		const balances = await api.get("/v1/accounts/balances");
		expect(balances.status).toBe(200);
		const parsed = accountBalancesResponse.parse(balances.body);
		expect(parsed.totalCents).toBe(20535);
		expect(parsed.withoutBalanceCount).toBe(1);
		expect(parsed.accounts[0]).toMatchObject({ name: "Mercado Pago", sharePercent: 100 });

		await api.post("/v1/transactions", {
			kind: "income",
			amountCents: 100000,
			date: "2026-11-05",
			description: "Salário",
			accountId: mp.id,
		});
		await api.post("/v1/transactions", {
			kind: "expense",
			amountCents: 2500,
			date: "2026-11-06",
			description: "Padaria",
			accountId: mp.id,
		});
		const flow = cashFlowResponse.parse((await api.get("/v1/cash-flow/2026-11")).body);
		expect(flow).toMatchObject({ inCents: 100000, outCents: 2500, netCents: 97500 });
		expect((await api.get("/v1/cash-flow/2026-13")).status).toBe(400);
	});

	it("GET /v1/summary/:month/daily fecha com o Gasto do Início; parcelas trazem o andamento pela parcela vista", async () => {
		const { api, basics } = await setupFinance();
		const { account } = await basics();
		for (const [date, amountCents, description] of [
			["2026-11-02", 6000, "iFood"],
			["2026-11-10", 20000, "Posto Shell"],
		] as const) {
			await api.post("/v1/transactions", {
				kind: "expense",
				amountCents,
				date,
				description,
				accountId: account.id,
			});
		}
		const daily = spendingDailyResponse.parse((await api.get("/v1/summary/2026-11/daily")).body);
		const summary = (await api.get("/v1/summary/2026-11")).body;
		expect(daily.spentCents).toBe(summary.summary.spentCents);
		expect(daily.current.at(-1)?.cumulativeCents).toBe(26000);
		expect(daily.topMerchants[0]).toMatchObject({ name: "Posto Shell", totalCents: 20000, count: 1 });
	});

	it("GET /v1/installments: 11 de 21 de R$ 86,87", async () => {
		const { api, stores, basics } = await setupFinance();
		const { card } = await basics();
		await stores.transactions.upsertInstallmentByExternal(
			"pluggy",
			"g1-11",
			{
				kind: "expense",
				amountCents: 8687,
				description: "Kabum",
				cardId: card.id,
				date: "2026-11-02",
				invoiceMonth: "2026-11",
				budgetMonth: "2026-11",
			},
			{ groupId: "g1", number: 11, count: 21 },
		);
		const [group] = (await api.get("/v1/installments")).body.groups;
		expect(group).toMatchObject({
			count: 21,
			currentNumber: 11,
			installmentCents: 8687,
			paidCount: 10,
			paidEstimated: true,
			remainingCount: 11,
			committedMonthCents: 8687,
			lastInvoiceMonth: "2027-09",
		});
	});
});
