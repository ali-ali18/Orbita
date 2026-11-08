import { budgetStatus } from "./budget.ts";
import { summarizeMonth, type Transaction } from "./classification.ts";
import { addMonths, monthOf, parseMonthKey } from "./dates.ts";
import type { InvoiceComposition } from "./invoice-composition.ts";
import { assertCents } from "./money.ts";
import type { Cents, LocalDate, MonthKey } from "./types.ts";

/** Quantos meses antes do relatório entram na média. */
export const REPORT_AVERAGE_MONTHS = 3;
export const REPORT_TOP_CATEGORIES = 5;
export const REPORT_BIGGEST_EXPENSES = 5;

/** O que o relatório olha de cada lançamento: o do engine mais o texto, para listar as maiores despesas. */
export interface ReportTransaction extends Transaction {
	description: string;
}

export interface ReportBudget {
	/** `null` = o orçamento total do mês. */
	categoryId: string | null;
	limitCents: Cents;
}

export interface ReportInvoice {
	cardId: string;
	composition: InvoiceComposition;
}

export interface MonthReportInput {
	month: MonthKey;
	/**
	 * Lançamentos do mês e dos {@link REPORT_AVERAGE_MONTHS} anteriores (por mês de orçamento), mais as compras
	 * originais dos estornos que moram em outro mês. O engine separa cada mês.
	 */
	transactions: readonly ReportTransaction[];
	/** Ids dos lançamentos que nasceram de uma recorrência (assinaturas) em qualquer um desses meses. */
	recurringTransactionIds: ReadonlySet<string>;
	budgets: readonly ReportBudget[];
	/** A fatura de cada cartão que vence no mês (a composição vem de `invoiceComposition`). */
	invoices: readonly ReportInvoice[];
	topCategories?: number;
	biggestExpenses?: number;
}

/** Quanto mudou contra uma referência (mês anterior ou média). `percent` é inteiro; `null` se a referência é zero. */
export interface MetricChange {
	referenceCents: Cents;
	deltaCents: Cents;
	percent: number | null;
}

export interface ReportTotals {
	incomeCents: Cents;
	spentCents: Cents;
	/** Entrou menos saiu; negativo quando o mês fechou no vermelho. */
	balanceCents: Cents;
	refundCreditCents: Cents;
}

export interface ReportComparison {
	/** Mês ou meses usados como referência. */
	months: MonthKey[];
	income: MetricChange;
	spent: MetricChange;
	balance: MetricChange;
}

export interface ReportCategory {
	categoryId: string;
	spentCents: Cents;
	previousCents: Cents;
	deltaCents: Cents;
	percent: number | null;
	/** Fatia do gasto do mês, em %, inteira. */
	sharePercent: number;
}

export interface ReportExpense {
	id: string;
	description: string;
	amountCents: Cents;
	date: LocalDate;
	categoryId: string | null;
}

export interface ReportBudgetRow {
	categoryId: string | null;
	limitCents: Cents;
	spentCents: Cents;
	remainingCents: Cents;
	ratio: number | null;
	overBudget: boolean;
}

export interface MonthReport {
	month: MonthKey;
	/** Primeiro dia depois do fechamento do mês (a data do "Fechamento"). */
	closedOn: LocalDate;
	totals: ReportTotals;
	/** `null` quando o mês anterior não tem nenhum lançamento. */
	vsPrevious: ReportComparison | null;
	/** Média dos meses anteriores que tiveram movimento; `null` sem nenhum. */
	vsAverage: ReportComparison | null;
	topCategories: ReportCategory[];
	biggestExpenses: ReportExpense[];
	subscriptions: { totalCents: Cents; count: number; change: MetricChange | null };
	budget: {
		rows: ReportBudgetRow[];
		withinCount: number;
		overCount: number;
		adherencePercent: number | null;
	};
	invoices: { cards: Array<{ cardId: string } & InvoiceComposition>; totalCents: Cents };
}

/** Variação em % inteira, arredondada de forma simétrica (o sinal não muda o arredondamento); sem referência, não há %. */
export function percentChange(current: Cents, reference: Cents): number | null {
	assertCents(current, "current");
	assertCents(reference, "reference");
	if (reference === 0) return null;
	const scaled = Math.abs(current - reference) * 100;
	if (!Number.isSafeInteger(scaled)) throw new RangeError("variação excede o inteiro seguro");
	const magnitude = Math.round(scaled / Math.abs(reference));
	return current - reference < 0 ? -magnitude : magnitude;
}

const change = (current: Cents, reference: Cents): MetricChange => ({
	referenceCents: reference,
	deltaCents: current - reference,
	percent: percentChange(current, reference),
});

const hasMovement = (totals: ReportTotals) =>
	totals.incomeCents > 0 || totals.spentCents > 0 || totals.refundCreditCents > 0;

function totalsOf(transactions: readonly Transaction[], month: MonthKey) {
	const summary = summarizeMonth(transactions, month);
	const totals: ReportTotals = {
		incomeCents: summary.incomeCents,
		spentCents: summary.spentCents,
		balanceCents: summary.incomeCents - summary.spentCents,
		refundCreditCents: summary.refundCreditCents,
	};
	return { summary, totals };
}

const compare = (current: ReportTotals, reference: ReportTotals, months: MonthKey[]): ReportComparison => ({
	months,
	income: change(current.incomeCents, reference.incomeCents),
	spent: change(current.spentCents, reference.spentCents),
	balance: change(current.balanceCents, reference.balanceCents),
});

const budgetMonthOf = (t: Transaction) => t.budgetMonth ?? monthOf(t.date);

/**
 * Relatório do mês, todo sobre o engine: o resumo (`summarizeMonth`) de cada mês, o orçamento (`budgetStatus`) e a
 * composição da fatura (`invoiceComposition`). Aqui só se comparam e ordenam esses números; nada de IA e nada de
 * float em dinheiro (as únicas frações são `ratio` e os percentuais, que não são dinheiro).
 */
export function monthReport(input: MonthReportInput): MonthReport {
	const { month } = input;
	parseMonthKey(month);
	const previousMonth = addMonths(month, -1);
	const earlier = Array.from({ length: REPORT_AVERAGE_MONTHS }, (_, i) => addMonths(month, -(i + 1)));

	const current = totalsOf(input.transactions, month);
	const previous = totalsOf(input.transactions, previousMonth);

	const vsPrevious = hasMovement(previous.totals)
		? compare(current.totals, previous.totals, [previousMonth])
		: null;

	const used = earlier
		.map((m) => ({ month: m, ...totalsOf(input.transactions, m) }))
		.filter((m) => hasMovement(m.totals));
	let vsAverage: ReportComparison | null = null;
	if (used.length > 0) {
		const avg = (pick: (t: ReportTotals) => Cents): Cents =>
			Math.round(used.reduce((sum, m) => sum + pick(m.totals), 0) / used.length);
		vsAverage = compare(
			current.totals,
			{
				incomeCents: avg((t) => t.incomeCents),
				spentCents: avg((t) => t.spentCents),
				balanceCents: avg((t) => t.balanceCents),
				refundCreditCents: avg((t) => t.refundCreditCents),
			},
			used.map((m) => m.month),
		);
	}

	const ids = new Set([
		...Object.keys(current.summary.byCategory),
		...Object.keys(previous.summary.byCategory),
	]);
	const topCategories = [...ids]
		.map((categoryId): ReportCategory => {
			const spentCents = current.summary.byCategory[categoryId] ?? 0;
			const previousCents = previous.summary.byCategory[categoryId] ?? 0;
			return {
				categoryId,
				spentCents,
				previousCents,
				deltaCents: spentCents - previousCents,
				percent: percentChange(spentCents, previousCents),
				sharePercent:
					current.totals.spentCents > 0 ? Math.round((spentCents * 100) / current.totals.spentCents) : 0,
			};
		})
		.filter((c) => c.spentCents > 0 || c.previousCents > 0)
		.sort(
			(a, b) =>
				b.spentCents - a.spentCents ||
				b.previousCents - a.previousCents ||
				a.categoryId.localeCompare(b.categoryId),
		)
		.slice(0, input.topCategories ?? REPORT_TOP_CATEGORIES);

	const biggestExpenses = input.transactions
		.filter((t) => t.kind === "expense" && budgetMonthOf(t) === month)
		.sort((a, b) => b.amountCents - a.amountCents || b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
		.slice(0, input.biggestExpenses ?? REPORT_BIGGEST_EXPENSES)
		.map(
			(t): ReportExpense => ({
				id: t.id,
				description: t.description,
				amountCents: t.amountCents,
				date: t.date,
				categoryId: t.categoryId ?? null,
			}),
		);

	const subscriptionsIn = (m: MonthKey) => {
		const rows = input.transactions.filter(
			(t) => t.kind === "expense" && budgetMonthOf(t) === m && input.recurringTransactionIds.has(t.id),
		);
		return { totalCents: rows.reduce((sum, t) => sum + t.amountCents, 0), count: rows.length };
	};
	const subsNow = subscriptionsIn(month);
	const subsBefore = subscriptionsIn(previousMonth);

	const rows = input.budgets.map((b): ReportBudgetRow => {
		const spentCents =
			b.categoryId === null ? current.totals.spentCents : (current.summary.byCategory[b.categoryId] ?? 0);
		const status = budgetStatus({ limitCents: b.limitCents, spentCents });
		return {
			categoryId: b.categoryId,
			limitCents: b.limitCents,
			spentCents,
			remainingCents: status.remainingCents,
			ratio: Number.isFinite(status.ratio) ? status.ratio : null,
			overBudget: status.overBudget,
		};
	});
	const overCount = rows.filter((r) => r.overBudget).length;
	const withinCount = rows.length - overCount;

	const cards = input.invoices.map((i) => ({ cardId: i.cardId, ...i.composition }));
	const invoiceTotal = cards.reduce((sum, c) => sum + c.totalCents, 0);
	if (!Number.isSafeInteger(invoiceTotal)) throw new RangeError("soma das faturas excede o inteiro seguro");

	return {
		month,
		closedOn: `${addMonths(month, 1)}-01`,
		totals: current.totals,
		vsPrevious,
		vsAverage,
		topCategories,
		biggestExpenses,
		subscriptions: {
			...subsNow,
			change: subsBefore.totalCents > 0 ? change(subsNow.totalCents, subsBefore.totalCents) : null,
		},
		budget: {
			rows,
			withinCount,
			overCount,
			adherencePercent: rows.length > 0 ? Math.round((withinCount * 100) / rows.length) : null,
		},
		invoices: { cards, totalCents: invoiceTotal },
	};
}
