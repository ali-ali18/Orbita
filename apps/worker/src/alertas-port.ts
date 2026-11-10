import type { FindingsPort, SavingsReading } from "@orbita/agents";
import {
	addMonths,
	type LocalDate,
	type MonthKey,
	monthOf,
	toLocalDate,
	type WatchedSpend,
} from "@orbita/core";
import type { Stores } from "@orbita/db";
import {
	categoryForSummary,
	countsAsSpending,
	listGoals,
	monthSummary,
	reportForMonth,
	savingsOpportunities,
} from "@orbita/ledger";

/**
 * A porta de dados dos agentes em cima das stores e do `@orbita/ledger`: os mesmos serviços das telas, então o
 * número de um aviso é o número que o app mostra. Lê o catálogo de categorias uma vez por rodada.
 */
export async function createFindingsPort(stores: Stores, now: () => Date): Promise<FindingsPort> {
	const today = toLocalDate(now());
	const categories = await stores.categories.list();
	const active = categories.filter((c) => c.archivedAt === null);
	const names = new Map(categories.map((c) => [c.id, c.name]));
	const bySlug = new Map(active.map((c) => [c.slug, c.id]));
	const outrosId = active.find((c) => c.slug === "outros")?.id ?? null;

	const monthsBetween = (from: LocalDate, to: LocalDate): MonthKey[] => {
		const out: MonthKey[] = [];
		for (let m = monthOf(from); m <= monthOf(to); m = addMonths(m, 1)) out.push(m);
		return out;
	};

	// A leitura de economia é cara (faturas, parcelas, 4 meses de lançamentos): feita uma vez por rodada.
	let savings: Promise<SavingsReading> | undefined;

	return {
		today,
		categoryName: (id) => names.get(id) ?? "Sem categoria",
		async expenses({ from, to }) {
			const perMonth = await Promise.all(
				monthsBetween(from, to).map((m) => stores.transactions.listByBudgetMonth(m)),
			);
			return perMonth
				.flat()
				.filter((t) => t.kind === "expense" && countsAsSpending(t) && t.date >= from && t.date <= to)
				.map(
					(t): WatchedSpend => ({
						id: t.id,
						date: t.date,
						amountCents: t.amountCents,
						// A mesma categoria que o Início mostra (iFood em Outros vira Delivery, por exemplo).
						categoryId: categoryForSummary(t, outrosId, bySlug),
						merchant: t.merchantName ?? t.description,
						installmentGroupId: t.installmentGroupId,
					}),
				);
		},
		monthSummary: (month) => monthSummary(stores, month, today),
		savings: () => {
			savings ??= savingsOpportunities(stores, now);
			return savings;
		},
		monthReport: (month) => reportForMonth(stores, month, today),
		goals: () => listGoals(stores, { today, dayOf: (d) => toLocalDate(d) }),
		async subscriptions() {
			const recurrences = await stores.recurrences.list();
			return recurrences
				.filter((r) => r.kind === "expense")
				.map((r) => ({ id: r.id, name: r.name, amountCents: r.amountCents }));
		},
		async recurringTransactionIds(months) {
			const postings = await Promise.all(months.map((m) => stores.recurrences.listPostings(m)));
			return new Set(postings.flat().map((p) => p.transactionId));
		},
	};
}
