import { addMonths, clampDayInMonth, monthOf, parseLocalDate, parseMonthKey } from "./dates.ts";
import { assertCents, sumCents } from "./money.ts";
import type { Cents, LocalDate, MonthKey } from "./types.ts";

export interface MonthlyRule {
	/** 1..31; em mês curto cai no último dia. */
	dayOfMonth: number;
	startDate: LocalDate;
	endDate?: LocalDate;
}

export interface MonthlyRecurrence extends MonthlyRule {
	amountCents: Cents;
}

function assertRule(rule: MonthlyRule): void {
	if (!Number.isInteger(rule.dayOfMonth) || rule.dayOfMonth < 1 || rule.dayOfMonth > 31) {
		throw new RangeError(`dia do mês inválido: ${rule.dayOfMonth}`);
	}
	parseLocalDate(rule.startDate);
	if (rule.endDate !== undefined) {
		parseLocalDate(rule.endDate);
		if (rule.endDate < rule.startDate) throw new RangeError("a data final é anterior à inicial");
	}
}

/** Datas do mês em que a regra cai (0 ou 1), respeitando início e fim (inclusive). */
export function occurrencesInMonth(rule: MonthlyRule, month: MonthKey): LocalDate[] {
	assertRule(rule);
	parseMonthKey(month);
	const date = clampDayInMonth(month, rule.dayOfMonth);
	if (date < rule.startDate) return [];
	if (rule.endDate !== undefined && date > rule.endDate) return [];
	return [date];
}

/** Primeira ocorrência na data `from` ou depois; `undefined` se a regra já terminou. */
export function nextOccurrence(rule: MonthlyRule, from: LocalDate): LocalDate | undefined {
	assertRule(rule);
	parseLocalDate(from);
	let month = monthOf(from > rule.startDate ? from : rule.startDate);
	// No máximo: o mês de partida (ocorrência já passada) e o seguinte.
	for (let i = 0; i < 2; i++) {
		const [date] = occurrencesInMonth(rule, month);
		if (date !== undefined && date >= from) return date;
		month = addMonths(month, 1);
	}
	return undefined;
}

/**
 * Soma das recorrências do mês que ainda vão cair. Ocorrência com a data de HOJE ou
 * depois é pendente: o débito do dia costuma entrar só à noite, e contar como pendente
 * é o lado seguro para "quanto posso gastar" (reserva o dinheiro). Quando o lançamento
 * real aparecer, quem chama deve parar de contar a recorrência para não duplicar.
 */
export function pendingInMonth(
	rules: readonly MonthlyRecurrence[],
	month: MonthKey,
	today: LocalDate,
): Cents {
	parseLocalDate(today);
	const amounts: Cents[] = [];
	for (const rule of rules) {
		assertCents(rule.amountCents, "amountCents");
		for (const date of occurrencesInMonth(rule, month)) {
			if (date >= today) amounts.push(rule.amountCents);
		}
	}
	return sumCents(amounts);
}
