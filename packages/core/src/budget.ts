import { daysInMonth, monthOf, parseLocalDate, parseMonthKey } from "./dates.ts";
import { assertCents } from "./money.ts";
import type { Cents, LocalDate, MonthKey } from "./types.ts";

export interface BudgetStatus {
	remainingCents: Cents;
	/** gasto / limite; passa de 1 quando estoura. Não é dinheiro, pode ser fracionário. */
	ratio: number;
	overBudget: boolean;
}

export function budgetStatus(input: { limitCents: Cents; spentCents: Cents }): BudgetStatus {
	assertCents(input.limitCents, "limitCents");
	assertCents(input.spentCents, "spentCents");
	if (input.limitCents < 0) throw new RangeError("o limite não pode ser negativo");
	const { limitCents, spentCents } = input;
	// Limite zero: qualquer gasto estoura; sem gasto, ratio 0.
	const ratio = limitCents === 0 ? (spentCents > 0 ? Number.POSITIVE_INFINITY : 0) : spentCents / limitCents;
	return { remainingCents: limitCents - spentCents, ratio, overBudget: spentCents > limitCents };
}

function monthPosition(today: LocalDate, month: MonthKey) {
	const { year, month: m } = parseMonthKey(month);
	const date = parseLocalDate(today);
	if (monthOf(today) !== month) throw new RangeError(`a data ${today} não está em ${month}`);
	const total = daysInMonth(year, m);
	return { elapsedDays: date.day, remainingDays: total - date.day + 1 };
}

export interface SafeToSpend {
	availableCents: Cents;
	perDayCents: Cents;
	remainingDays: number;
}

/** Quanto ainda dá para gastar por dia, já reservando as DESPESAS recorrentes que vão cair (receita nunca é reservada). */
export function safeToSpend(input: {
	budgetCents: Cents;
	spentCents: Cents;
	pendingRecurringExpenseCents: Cents;
	today: LocalDate;
	month: MonthKey;
}): SafeToSpend {
	assertCents(input.budgetCents, "budgetCents");
	assertCents(input.spentCents, "spentCents");
	assertCents(input.pendingRecurringExpenseCents, "pendingRecurringExpenseCents");
	const { remainingDays } = monthPosition(input.today, input.month);
	const availableCents = input.budgetCents - input.spentCents - input.pendingRecurringExpenseCents;
	// Os dias restantes incluem hoje: hoje ainda dá para gastar.
	const perDayCents = availableCents > 0 ? Math.floor(availableCents / remainingDays) : 0;
	return { availableCents, perDayCents, remainingDays };
}

export interface MonthProjection {
	projectedCents: Cents;
	/** Menos de 7 dias de dados: o ritmo diário ainda é muito instável para confiar. */
	lowConfidence: boolean;
}

const MIN_PROJECTION_DAYS = 7;

/**
 * Projeção do total do mês: o que já saiu + despesas recorrentes ainda por vir + o ritmo
 * do gasto variável (sem as recorrências, que têm data certa) estendido pelos dias que
 * faltam depois de hoje. Nos primeiros dias o ritmo engana (um mercado no dia 1 não é o
 * ritmo do mês), então o divisor é no mínimo 7 e `lowConfidence` avisa a tela.
 * Multiplica antes de dividir e arredonda uma vez só.
 */
export function projectMonth(input: {
	spentCents: Cents;
	pendingRecurringExpenseCents: Cents;
	variableSpentCents: Cents;
	today: LocalDate;
	month: MonthKey;
}): MonthProjection {
	assertCents(input.spentCents, "spentCents");
	assertCents(input.pendingRecurringExpenseCents, "pendingRecurringExpenseCents");
	assertCents(input.variableSpentCents, "variableSpentCents");
	const { elapsedDays, remainingDays } = monthPosition(input.today, input.month);
	const daysAfterToday = remainingDays - 1;
	const product = input.variableSpentCents * daysAfterToday;
	if (!Number.isSafeInteger(product)) throw new RangeError("projeção excede o inteiro seguro");
	const divisor = Math.max(elapsedDays, MIN_PROJECTION_DAYS);
	const projectedCents =
		input.spentCents + input.pendingRecurringExpenseCents + Math.round(product / divisor);
	assertCents(projectedCents, "projeção");
	return { projectedCents, lowConfidence: elapsedDays < MIN_PROJECTION_DAYS };
}
