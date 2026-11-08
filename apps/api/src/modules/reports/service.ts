import {
	addMonths,
	type LocalDate,
	type MonthKey,
	type MonthReport,
	monthReport,
	REPORT_AVERAGE_MONTHS,
	type ReportTransaction,
} from "@orbita/core";
import { type Stores, TOTAL_BUDGET_SCOPE, type TransactionRecord } from "@orbita/db";
import { cardInvoice, refundOriginalsOutside, toCoreTransaction } from "../summary/service.ts";

/**
 * Relatório do mês: junta os dados e entrega ao `monthReport` do engine. Os meses de comparação (anterior e os 3
 * antes) usam a mesma leitura e a mesma categoria do Início (`toCoreTransaction`), então os números batem com o
 * resumo. A fatura de cada cartão é a de `cardInvoice`, a mesma da tela do cartão.
 */
export async function reportForMonth(
	stores: Stores,
	month: MonthKey,
	today: LocalDate,
): Promise<MonthReport> {
	const months = Array.from({ length: REPORT_AVERAGE_MONTHS + 1 }, (_, i) => addMonths(month, -i));
	const [perMonth, postings, budgets, categories, cards] = await Promise.all([
		Promise.all(months.map((m) => stores.transactions.listByBudgetMonth(m))),
		Promise.all(months.map((m) => stores.recurrences.listPostings(m))),
		stores.budgets.list(),
		stores.categories.list(),
		stores.cards.list(),
	]);
	const txs: TransactionRecord[] = perMonth.flat();
	const active = categories.filter((c) => c.archivedAt === null);
	const bySlug = new Map(active.map((c) => [c.slug, c.id]));
	const outrosId = active.find((c) => c.slug === "outros")?.id ?? null;
	const originals = await refundOriginalsOutside(stores, txs);

	// Sem categoria = "Outros", como no Início (o engine chamaria de "outros"; aqui já é o id real).
	const toReport = (t: TransactionRecord): ReportTransaction => {
		const core = toCoreTransaction(t, outrosId, bySlug);
		return {
			...core,
			description: t.description,
			...(core.categoryId === undefined && outrosId !== null ? { categoryId: outrosId } : {}),
		};
	};

	const invoices = await Promise.all(
		cards
			.filter((c) => c.archivedAt === null)
			.map(async (card) => ({
				cardId: card.id,
				composition: (await cardInvoice(stores, card.id, month, today)).composition,
			})),
	);

	return monthReport({
		month,
		transactions: [...txs, ...originals].map(toReport),
		recurringTransactionIds: new Set(postings.flat().map((p) => p.transactionId)),
		budgets: budgets.map((b) => ({
			categoryId: b.scope === TOTAL_BUDGET_SCOPE ? null : b.scope,
			limitCents: b.limitCents,
		})),
		invoices,
	});
}
