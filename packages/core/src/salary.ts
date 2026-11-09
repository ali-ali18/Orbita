import { addMonths, clampDayInMonth, daysBetween, monthOf } from "./dates.ts";
import type { IncomeSource } from "./income.ts";
import { findMonthlyRuns } from "./subscription-hunt.ts";
import type { Cents, LocalDate } from "./types.ts";

/*
 * Reconhecer salário entre as entradas: crédito que volta todo mês do mesmo pagador com valor parecido, ou que bate com
 * a renda que o dono cadastrou (valor e dia). Função pura: quem chama decide o que fazer com os ids (e respeita a
 * categoria que o dono escolheu à mão).
 */

/** Pagador recorrente só vale como salário a partir deste valor (R$ 1.000): Pix de amigo todo mês não é salário. */
export const SALARY_MIN_CENTS: Cents = 100_000;
/** Meses seguidos do mesmo pagador para reconhecer o salário sem renda cadastrada. */
export const SALARY_MIN_MONTHS = 2;
/** Tolerância de valor para casar com a renda cadastrada (em %): reajuste pequeno e centavos não escondem o salário. */
export const SALARY_INCOME_MATCH_PERCENT = 2;
/** Tolerância de dia para casar com a renda cadastrada: pagamento antecipado por fim de semana e feriado. */
export const SALARY_PAYDAY_TOLERANCE_DAYS = 5;

export interface SalaryCredit {
	id: string;
	date: LocalDate;
	amountCents: Cents;
	/** Quem pagou, já normalizado (mesma chave para o mesmo pagador). Vazio = não dá para saber. */
	payer: string;
}

export type SalaryReason = "recurring_payer" | "income_plan";

/**
 * Quais entradas são salário, e por quê.
 * - `income_plan`: o valor está a até `SALARY_INCOME_MATCH_PERCENT` % de uma renda mensal cadastrada e a data cai a até
 *   `SALARY_PAYDAY_TOLERANCE_DAYS` dias do dia de pagamento dela.
 * - `recurring_payer`: o mesmo pagador creditou, em pelo menos `SALARY_MIN_MONTHS` meses seguidos, valores parecidos
 *   (até 10 % da mediana) de `SALARY_MIN_CENTS` ou mais; a última entrada é recente (até 45 dias).
 */
export function findSalaryCredits(input: {
	credits: readonly SalaryCredit[];
	incomeSources: readonly IncomeSource[];
	today: LocalDate;
}): Map<string, SalaryReason> {
	const found = new Map<string, SalaryReason>();
	const monthly = input.incomeSources.filter((s) => s.recurring);
	for (const credit of input.credits) {
		if (monthly.some((s) => matchesSource(credit, s))) found.set(credit.id, "income_plan");
	}
	const withPayer = input.credits.filter((c) => c.payer !== "" && c.amountCents >= SALARY_MIN_CENTS);
	const runs = findMonthlyRuns({
		charges: withPayer.map((c) => ({
			id: c.id,
			date: c.date,
			amountCents: c.amountCents,
			merchant: c.payer,
		})),
		today: input.today,
		brandOf: (payer) => payer,
		minOccurrences: SALARY_MIN_MONTHS,
	});
	for (const run of runs) {
		for (const c of run.charges) if (!found.has(c.id)) found.set(c.id, "recurring_payer");
	}
	return found;
}

function matchesSource(credit: SalaryCredit, source: IncomeSource): boolean {
	if (
		Math.abs(credit.amountCents - source.amountCents) * 100 >
		source.amountCents * SALARY_INCOME_MATCH_PERCENT
	) {
		return false;
	}
	const month = monthOf(credit.date);
	// O pagamento do dia 1º pode cair no fim do mês anterior (e o do dia 30, no começo do seguinte).
	return [addMonths(month, -1), month, addMonths(month, 1)].some(
		(m) =>
			Math.abs(daysBetween(clampDayInMonth(m, source.payday), credit.date)) <= SALARY_PAYDAY_TOLERANCE_DAYS,
	);
}
