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
	id: string;
	/** Despesa (aluguel) ou receita (salário). Só despesa é reservada no orçamento. */
	kind: "expense" | "income";
	amountCents: Cents;
}

/** Lançamento real que já cumpriu a recorrência `recurrenceId` no mês `month`. */
export interface PostedRecurrence {
	recurrenceId: string;
	month: MonthKey;
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

function assertRecurrence(rule: MonthlyRecurrence): void {
	assertRule(rule);
	// Sem valor padrão: um `kind` desconhecido virando receita (ou despesa) erraria dinheiro em silêncio.
	if (rule.kind !== "expense" && rule.kind !== "income") {
		throw new TypeError(`tipo de recorrência inválido: ${String(rule.kind)}`);
	}
	assertCents(rule.amountCents, "amountCents");
	if (rule.amountCents <= 0) throw new RangeError(`recorrência ${rule.id}: o valor deve ser positivo`);
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

export interface PendingRecurring {
	expenseCents: Cents;
	incomeCents: Cents;
}

/**
 * O que ainda se espera das recorrências no mês, separado por direção. Uma ocorrência é
 * pendente se NÃO foi lançada naquele mês, seja a data futura ou passada: o aluguel que já
 * foi debitado (mesmo adiantado) não pode ser reservado de novo, e a conta vencida e ainda
 * não paga continua esperada. Decidir pela data duplicaria ou perderia valores.
 */
export function pendingInMonth(
	rules: readonly MonthlyRecurrence[],
	month: MonthKey,
	posted: readonly PostedRecurrence[],
): PendingRecurring {
	parseMonthKey(month);
	const done = new Set(posted.filter((p) => p.month === month).map((p) => p.recurrenceId));
	const expenses: Cents[] = [];
	const incomes: Cents[] = [];
	for (const rule of rules) {
		assertRecurrence(rule);
		if (done.has(rule.id)) continue;
		for (const _ of occurrencesInMonth(rule, month)) {
			(rule.kind === "expense" ? expenses : incomes).push(rule.amountCents);
		}
	}
	return { expenseCents: sumCents(expenses), incomeCents: sumCents(incomes) };
}

export interface SubscriptionCommitment {
	/** Quantas despesas recorrentes ainda valem (não terminaram). */
	count: number;
	/** Quanto elas pesam por mês, todas somadas, caiam ou não neste mês. */
	monthlyCents: Cents;
}

/**
 * Compromisso mensal fixo: a soma de TODAS as despesas recorrentes ainda ativas em `today` (sem data final, ou com
 * data final de hoje em diante), em centavos inteiros. Não olha se a cobrança cai neste mês nem se já foi lançada:
 * a data de início também não conta: uma assinatura cuja primeira cobrança cai só no mês seguinte também é compromisso (olhar só o mês deixava de fora a que
 * "vence em 27 dias"). Quem chama passa só o que não está arquivado.
 */
export function subscriptionCommitment(
	rules: ReadonlyArray<
		Pick<MonthlyRecurrence, "kind" | "amountCents"> & { endDate?: LocalDate | null | undefined }
	>,
	today: LocalDate,
): SubscriptionCommitment {
	const active = rules.filter((r) => r.kind === "expense" && (r.endDate == null || r.endDate >= today));
	for (const r of active) assertCents(r.amountCents, "amountCents");
	return { count: active.length, monthlyCents: sumCents(active.map((r) => r.amountCents)) };
}
