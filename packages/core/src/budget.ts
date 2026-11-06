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

/** Quanto ainda dá para gastar por dia, já reservando as recorrências que vão cair. */
export function safeToSpend(input: {
	budgetCents: Cents;
	spentCents: Cents;
	pendingRecurringCents: Cents;
	today: LocalDate;
	month: MonthKey;
}): SafeToSpend {
	assertCents(input.budgetCents, "budgetCents");
	assertCents(input.spentCents, "spentCents");
	assertCents(input.pendingRecurringCents, "pendingRecurringCents");
	const { remainingDays } = monthPosition(input.today, input.month);
	const availableCents = input.budgetCents - input.spentCents - input.pendingRecurringCents;
	// Os dias restantes incluem hoje: hoje ainda dá para gastar.
	const perDayCents = availableCents > 0 ? Math.floor(availableCents / remainingDays) : 0;
	return { availableCents, perDayCents, remainingDays };
}

/**
 * Projeção do total do mês: o que já saiu + recorrências ainda por vir + o ritmo do gasto
 * variável (sem as recorrências, que têm data certa) estendido pelos dias que faltam
 * depois de hoje. Multiplica antes de dividir e arredonda uma vez só.
 */
export function projectMonth(input: {
	spentCents: Cents;
	pendingRecurringCents: Cents;
	variableSpentCents: Cents;
	today: LocalDate;
	month: MonthKey;
}): Cents {
	assertCents(input.spentCents, "spentCents");
	assertCents(input.pendingRecurringCents, "pendingRecurringCents");
	assertCents(input.variableSpentCents, "variableSpentCents");
	const { elapsedDays, remainingDays } = monthPosition(input.today, input.month);
	const daysAfterToday = remainingDays - 1;
	const product = input.variableSpentCents * daysAfterToday;
	if (!Number.isSafeInteger(product)) throw new RangeError("projeção excede o inteiro seguro");
	const total = input.spentCents + input.pendingRecurringCents + Math.round(product / elapsedDays);
	assertCents(total, "projeção");
	return total;
}
