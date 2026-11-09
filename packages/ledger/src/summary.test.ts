import { createMemoryStores } from "@orbita/db";
import { PAYMENT_REVIEW_NOTE } from "@orbita/ingest";
import { describe, expect, it } from "vitest";
import { countsAsSpending, loadSpendingMonth, monthSummary } from "./summary.ts";

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
