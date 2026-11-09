import { createMemoryStores } from "@orbita/db";
import { PAYMENT_REVIEW_NOTE } from "@orbita/ingest";
import { describe, expect, it } from "vitest";
import { cardInvoice, countsAsSpending, loadSpendingMonth, monthSummary } from "./summary.ts";

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
		const card = await stores.cards.create({ name: "Manual", closingDay: 25, dueDay: 5 });
		const pay = (date: string, amountCents: number) =>
			stores.transactions.create({
				kind: "card_payment",
				amountCents,
				date,
				description: "Fatura",
				accountId: account?.id,
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
});
