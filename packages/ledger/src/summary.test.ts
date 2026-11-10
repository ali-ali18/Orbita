import { createMemoryStores } from "@orbita/db";
import { PAYMENT_REVIEW_NOTE } from "@orbita/ingest";
import { describe, expect, it } from "vitest";
import { createAgentReader } from "./agent-reader.ts";
import { invoicesOverview, monthState } from "./invoices-overview.ts";
import {
	cardInvoice,
	countsAsSpending,
	loadSpendingMonth,
	monthSummary,
	spendingBreakdown,
} from "./summary.ts";

const NOW = new Date("2026-11-12T15:00:00Z");
const TODAY = "2026-11-12";

async function seed() {
	const stores = createMemoryStores({ now: () => NOW });
	const account = await stores.accounts.create({ name: "Conta Inter", kind: "checking" });
	await stores.categories.ensureDefaults();
	const base = { date: "2026-11-05", accountId: account.id };
	return { stores, base };
}

describe("gasto do mês e pagamento de fatura em revisão", () => {
	it("pendente com a nota de revisão de pagamento fica fora do gasto; os outros pendentes continuam contando", async () => {
		const { stores, base } = await seed();
		await stores.transactions.create({
			...base,
			kind: "expense",
			amountCents: 10_000,
			description: "Mercado",
		});
		// Notificação do banco, ainda sem revisão: o dinheiro saiu, conta.
		await stores.transactions.create({
			...base,
			kind: "expense",
			amountCents: 2_500,
			description: "Padaria",
			status: "pending",
			source: "notification",
		});
		// Pagamento de fatura que o Órbita não soube ligar a um cartão: fora do gasto até o dono revisar.
		const review = await stores.transactions.create({
			...base,
			kind: "expense",
			amountCents: 83_010,
			description: "Pagamento de fatura Cartão",
			status: "pending",
			note: PAYMENT_REVIEW_NOTE,
		});
		const summary = await monthSummary(stores, "2026-11", TODAY);
		expect(summary.summary.spentCents).toBe(12_500);

		const ids = (await loadSpendingMonth(stores, "2026-11", TODAY)).map((t) => t.id);
		expect(ids).not.toContain(review.id);

		// O dono confirmou ("é gasto mesmo"): passa a contar.
		await stores.transactions.update(review.id, { status: "confirmed", editedByOwner: true });
		expect((await monthSummary(stores, "2026-11", TODAY)).summary.spentCents).toBe(12_500 + 83_010);
	});

	it("compra pendente no banco (fatura aberta do cartão) conta no gasto do mês e na fatura", async () => {
		const { stores } = await seed();
		const card = await stores.cards.create({ name: "Nubank", closingDay: 10, dueDay: 17 });
		await stores.transactions.upsertByExternal("pluggy", "p-1", {
			kind: "expense",
			amountCents: 8_990,
			date: "2026-11-09",
			description: "Livraria",
			cardId: card.id,
			invoiceMonth: "2026-11",
			bankPending: true,
		});
		const row = (await loadSpendingMonth(stores, "2026-11", TODAY))[0];
		expect(row).toMatchObject({ bankPending: true, status: "confirmed" });
		expect((await monthSummary(stores, "2026-11", TODAY)).summary.spentCents).toBe(8_990);
		expect(countsAsSpending({ kind: "expense", status: "confirmed", note: null })).toBe(true);
	});

	it("countsAsSpending só exclui despesa pendente com a nota de revisão", () => {
		const row = { kind: "expense" as const, status: "pending" as const, note: PAYMENT_REVIEW_NOTE };
		expect(countsAsSpending(row)).toBe(false);
		expect(countsAsSpending({ ...row, status: "confirmed" })).toBe(true);
		expect(countsAsSpending({ ...row, note: "outra nota" })).toBe(true);
		expect(countsAsSpending({ ...row, note: null })).toBe(true);
	});
});

describe("resgate no resumo do mês", () => {
	it("abate o Investido e não entra na renda nem no gasto", async () => {
		const { stores, base } = await seed();
		await stores.transactions.create({
			...base,
			kind: "investment",
			amountCents: 100_000,
			description: "CDB",
		});
		await stores.transactions.create({
			...base,
			kind: "redemption",
			amountCents: 40_000,
			description: "Resgate CDB",
		});
		await stores.transactions.create({
			...base,
			kind: "income",
			amountCents: 500,
			description: "Rendimento CDB",
		});
		const { summary } = await monthSummary(stores, "2026-11", TODAY);
		expect(summary).toMatchObject({ investedCents: 60_000, incomeCents: 500, spentCents: 0 });
	});
});

describe("fatura paga com pagamento adiantado", () => {
	async function manualCard() {
		const { stores } = await seed();
		const account = (await stores.accounts.list())[0];
		if (!account) throw new Error("sem conta");
		const card = await stores.cards.create({ name: "Manual", closingDay: 25, dueDay: 5 });
		const pay = (date: string, amountCents: number) =>
			stores.transactions.create({
				kind: "card_payment",
				amountCents,
				date,
				description: "Fatura",
				accountId: account.id,
				cardId: card.id,
			});
		const bill = (externalId: string, dueDate: string, closeDate: string, totalAmountCents: number) =>
			stores.bills.upsert({
				cardId: card.id,
				source: "pluggy",
				externalId,
				dueDate,
				closeDate,
				totalAmountCents,
				payments: [],
				syncedAt: NOW,
			});
		return { stores, card, pay, bill };
	}

	it("cartão manual: pagamento da fatura anterior (compras de antes do Órbita) não marca a seguinte como paga", async () => {
		const { stores, card, pay } = await manualCard();
		await stores.transactions.create({
			kind: "expense",
			amountCents: 30_000,
			date: "2026-11-10",
			description: "Compra",
			cardId: card.id,
			invoiceMonth: "2026-12",
		});
		await pay("2026-11-03", 80_000); // pagou a 2026-11, cujas compras são anteriores ao Órbita
		const { invoice } = await cardInvoice(stores, card.id, "2026-12", "2026-11-28");
		expect(invoice.paidCents).toBe(0);
		expect(invoice.paymentStatus).toBe("unpaid");
	});

	it("pagamento atrasado de M-2 depois do fechamento de M-1 não marca M como paga", async () => {
		const { stores, card, pay, bill } = await manualCard();
		await bill("b-out", "2026-10-05", "2026-09-25", 50_000);
		await bill("b-nov", "2026-11-05", "2026-10-25", 30_000);
		await bill("b-dez", "2026-12-05", "2026-11-25", 30_000);
		await pay("2026-10-28", 80_000); // atrasado: quita a 2026-10 (50.000) e a 2026-11 (30.000)
		const dez = await cardInvoice(stores, card.id, "2026-12", "2026-11-28");
		expect(dez.invoice.paidCents).toBe(0);
		expect(dez.invoice.paymentStatus).toBe("unpaid");
	});

	it("fatura do banco paga pelos payments da seguinte: cardInvoice concorda com o overview (paga, sem saldo a pagar)", async () => {
		const { stores, card, bill } = await manualCard();
		await bill("b-nov", "2026-11-05", "2026-10-25", 34_370);
		await stores.bills.upsert({
			cardId: card.id,
			source: "pluggy",
			externalId: "b-dez",
			dueDate: "2026-12-05",
			closeDate: "2026-11-25",
			totalAmountCents: 10_000,
			payments: [{ externalId: "p1", date: "2026-11-03", amountCents: 34_370 } as never],
			syncedAt: NOW,
		});
		const nov = await cardInvoice(stores, card.id, "2026-11", "2026-11-28");
		expect(nov.invoice).toMatchObject({ paidCents: 34_370, paymentStatus: "paid" });
		const overview = await invoicesOverview(stores, "2026-11-28");
		const novLine = overview.history.find((h) => h.month === "2026-11");
		expect(novLine?.state).toBe("paid");
	});
	it("sem fatura do banco para M-2, nenhum excedente é repassado: o pagamento atrasado não marca M como paga", async () => {
		const { stores, card, pay, bill } = await manualCard();
		// Só 2026-11 e 2026-12 vieram do banco; a de outubro (a que o pagamento de 800 pode ter quitado) não.
		await bill("b-nov", "2026-11-05", "2026-10-25", 30_000);
		await bill("b-dez", "2026-12-05", "2026-11-25", 30_000);
		await pay("2026-10-28", 80_000);
		const dez = await cardInvoice(stores, card.id, "2026-12", "2026-11-28");
		expect(dez.invoice.paidCents).toBe(0);
		expect(dez.invoice.paymentStatus).toBe("unpaid");
	});

	it("a dívida de M-2 considera o que o banco registrou em payments[]", async () => {
		const { stores, card, pay, bill } = await manualCard();
		// A fatura de outubro (50.000) foi paga no dia 03/10 (registrado no banco, sem card_payment no Órbita).
		await stores.bills.upsert({
			cardId: card.id,
			source: "pluggy",
			externalId: "b-out",
			dueDate: "2026-10-05",
			closeDate: "2026-09-25",
			totalAmountCents: 50_000,
			payments: [{ externalId: "p-out", date: "2026-10-03", amountCents: 50_000 } as never],
			syncedAt: NOW,
		});
		await bill("b-nov", "2026-11-05", "2026-10-25", 30_000);
		await bill("b-dez", "2026-12-05", "2026-11-25", 30_000);
		await pay("2026-10-28", 80_000); // 30.000 quitam a 2026-11; os 50.000 que sobram valem para a 2026-12 (30.000)
		const dez = await cardInvoice(stores, card.id, "2026-12", "2026-11-28");
		expect(dez.invoice).toMatchObject({ paidCents: 30_000, paymentStatus: "paid" });
	});
});

describe("total e o que falta numa fonte só", () => {
	const TODAY_NOV = "2026-11-12";
	async function bankPartial() {
		const { stores } = await seed();
		const account = (await stores.accounts.list())[0];
		if (!account) throw new Error("sem conta");
		const card = await stores.cards.create({ name: "Manual", closingDay: 25, dueDay: 5 });
		// Banco: fatura de novembro 1.000,00; o Órbita só conhece 600,00 em lançamentos; pagos 700,00.
		await stores.bills.upsert({
			cardId: card.id,
			source: "pluggy",
			externalId: "b-nov",
			dueDate: "2026-11-05",
			closeDate: "2026-10-25",
			totalAmountCents: 100_000,
			payments: [],
			syncedAt: NOW,
		});
		await stores.transactions.create({
			kind: "expense",
			amountCents: 60_000,
			date: "2026-10-10",
			description: "Compra",
			cardId: card.id,
			invoiceMonth: "2026-11",
		});
		await stores.transactions.create({
			kind: "card_payment",
			amountCents: 70_000,
			date: "2026-10-30",
			description: "Fatura",
			accountId: account.id,
			cardId: card.id,
		});
		return { stores, card };
	}

	it("banco 1.000 / lançamentos 600 / pago 700: parcial, faltam 300 no detalhe, na IA e no overview", async () => {
		const { stores, card } = await bankPartial();
		const { invoice, composition } = await cardInvoice(stores, card.id, "2026-11", TODAY_NOV);
		expect(composition.totalCents).toBe(60_000);
		expect(invoice).toMatchObject({
			totalCents: 100_000,
			paidCents: 70_000,
			owedCents: 30_000,
			paymentStatus: "partial",
		});
		const reader = createAgentReader(stores, () => new Date("2026-11-12T15:00:00Z"));
		expect(await reader.cardInvoice(card.id, "2026-11")).toMatchObject({
			paymentStatus: "partial",
			totalCents: 100_000,
			paidCents: 70_000,
			owedCents: 30_000,
		});
		const overview = await invoicesOverview(stores, TODAY_NOV);
		expect(overview.cards[0]?.due).toMatchObject({
			month: "2026-11",
			totalCents: 100_000,
			owedCents: 30_000,
		});
	});

	it("total do banco 0 com lançamentos: paga e nada a dever em todo lugar", async () => {
		const { stores } = await seed();
		const card = await stores.cards.create({ name: "Manual", closingDay: 25, dueDay: 5 });
		await stores.bills.upsert({
			cardId: card.id,
			source: "pluggy",
			externalId: "b-nov",
			dueDate: "2026-11-05",
			closeDate: "2026-10-25",
			totalAmountCents: 0,
			payments: [],
			syncedAt: NOW,
		});
		await stores.transactions.create({
			kind: "expense",
			amountCents: 60_000,
			date: "2026-10-10",
			description: "Compra",
			cardId: card.id,
			invoiceMonth: "2026-11",
		});
		const reader = createAgentReader(stores, () => new Date("2026-11-12T15:00:00Z"));
		expect(await reader.cardInvoice(card.id, "2026-11")).toMatchObject({
			paymentStatus: "paid",
			totalCents: 0,
			owedCents: 0,
		});
		const { invoice } = await cardInvoice(stores, card.id, "2026-11", TODAY_NOV);
		expect(invoice).toMatchObject({ totalCents: 0, owedCents: 0, paymentStatus: "paid" });
	});

	it("fatura aberta: o que se deve é o total dos lançamentos", async () => {
		const { stores, card } = await bankPartial();
		const { invoice } = await cardInvoice(stores, card.id, "2026-12", TODAY_NOV);
		expect(invoice).toMatchObject({ paymentStatus: "open", owedCents: invoice.totalCents });
	});
});

describe("pagamentos do banco atribuídos pela data", () => {
	async function bankCard() {
		const { stores } = await seed();
		const card = await stores.cards.create({ name: "Manual", closingDay: 25, dueDay: 5 });
		const bill = (
			externalId: string,
			dueDate: string,
			closeDate: string,
			total: number,
			payments: [string, number][],
		) =>
			stores.bills.upsert({
				cardId: card.id,
				source: "pluggy",
				externalId,
				dueDate,
				closeDate,
				totalAmountCents: total,
				payments: payments.map(
					([date, amountCents], i) => ({ externalId: `${externalId}-${i}`, date, amountCents }) as never,
				),
				syncedAt: NOW,
			});
		return { stores, card, bill };
	}

	it("banco que lista o pagamento da própria fatura (e não na seguinte) também a dá como paga", async () => {
		const { stores, card, bill } = await bankCard();
		// Setembro (vence 05/09, fecha 25/08) paga em 30/08, listada nela mesma; outubro sem pagamento listado.
		await bill("b-set", "2026-09-05", "2026-08-25", 50_000, [["2026-08-30", 50_000]]);
		await bill("b-out", "2026-10-05", "2026-09-25", 40_000, []);
		const set = await cardInvoice(stores, card.id, "2026-09", "2026-11-12");
		expect(set.invoice).toMatchObject({ paidCents: 50_000, paymentStatus: "paid", owedCents: 0 });
		// Outubro continua sem pagamento: a de setembro não vaza para ela.
		const out = await cardInvoice(stores, card.id, "2026-10", "2026-11-12");
		expect(out.invoice.paidCents).toBe(0);
	});

	it("banco que lista o pagamento na fatura seguinte continua valendo (pelo dia do pagamento)", async () => {
		const { stores, card, bill } = await bankCard();
		await bill("b-set", "2026-09-05", "2026-08-25", 50_000, []);
		await bill("b-out", "2026-10-05", "2026-09-25", 40_000, [["2026-09-02", 50_000]]); // dia 02/09: janela de setembro
		const set = await cardInvoice(stores, card.id, "2026-09", "2026-11-12");
		expect(set.invoice).toMatchObject({ paidCents: 50_000, paymentStatus: "paid" });
	});
});

describe("fatura antiga sem pagamento registrado é histórico, não cobrança", () => {
	it("fora dos meses considerados: estado neutro no detalhe, na IA e no overview; paga continua paga", async () => {
		const { stores } = await seed();
		const card = await stores.cards.create({ name: "Manual", closingDay: 25, dueDay: 5 });
		const bill = (
			externalId: string,
			dueDate: string,
			closeDate: string,
			total: number,
			payments: unknown[],
		) =>
			stores.bills.upsert({
				cardId: card.id,
				source: "pluggy",
				externalId,
				dueDate,
				closeDate,
				totalAmountCents: total,
				payments: payments as never,
				syncedAt: NOW,
			});
		await bill("b-jul", "2026-07-05", "2026-06-25", 30_000, []);
		await bill("b-ago", "2026-08-05", "2026-07-25", 40_000, [
			{ externalId: "p", date: "2026-07-30", amountCents: 40_000 },
		]);
		const jul = await cardInvoice(stores, card.id, "2026-07", "2026-11-12");
		expect(jul.invoice).toMatchObject({ paymentStatus: "history", owedCents: 0, paidCents: 0 });
		const ago = await cardInvoice(stores, card.id, "2026-08", "2026-11-12");
		expect(ago.invoice).toMatchObject({ paymentStatus: "paid", owedCents: 0 });
		const reader = createAgentReader(stores, () => new Date("2026-11-12T15:00:00Z"));
		expect(await reader.cardInvoice(card.id, "2026-07")).toMatchObject({
			paymentStatus: "history",
			owedCents: 0,
		});
		const overview = await invoicesOverview(stores, "2026-11-12");
		const point = overview.history.find((h) => h.month === "2026-07");
		expect(point?.state).toBe("history");
		expect(overview.history.find((h) => h.month === "2026-08")?.state).toBe("paid");
	});

	it("um mês com uma fatura paga e outra só histórica fica paga (histórico nunca passa na frente)", () => {
		expect(monthState(["history", "paid"])).toBe("paid");
		expect(monthState(["history", "history"])).toBe("history");
		expect(monthState(["closed", "history"])).toBe("closed");
	});
});

describe("conexão removida: contas e cartões arquivados continuam no histórico do mês", () => {
	it("a lista por cartão inclui o cartão arquivado por conexão removida e bate com os totais", async () => {
		const { stores } = await seed();
		const card = await stores.cards.create({
			name: "Cartão antigo",
			closingDay: 10,
			dueDay: 17,
			source: "pluggy",
			externalId: "c1",
		});
		await stores.cards.linkConnection(card.id, "gone");
		await stores.transactions.create({
			date: "2026-11-05",
			cardId: card.id,
			invoiceMonth: "2026-11",
			kind: "expense",
			amountCents: 7_000,
			description: "Livraria",
		});
		await stores.cards.archiveByConnection("gone");
		const month = await spendingBreakdown(stores, "2026-11", TODAY);
		const total = month.cards.reduce((sum, c) => sum + c.subtotalCents, 0);
		expect(month.cards.map((c) => c.cardId)).toEqual([card.id]);
		expect(total).toBe(7_000);
		expect(month.branches.find((b) => b.branch === "card")?.subtotalCents).toBe(7_000);
	});
});
