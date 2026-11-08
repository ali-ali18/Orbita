import { addMonths, clampDayInMonth, daysBetween, monthOf, parseLocalDate, parseMonthKey } from "./dates.ts";
import { assertCents, sumCents } from "./money.ts";
import type { Cents, LocalDate, MonthKey } from "./types.ts";

/** Uma fonte de renda como o engine a enxerga. */
export interface IncomeSource {
	id: string;
	/** Líquido, em centavos. */
	amountCents: Cents;
	/** Dia do mês (1 a 31); em mês curto cai no último dia. */
	payday: number;
	/** `true` = todo mês (salário). `false` = só no mês `month` (um freela). */
	recurring: boolean;
	/** Mês de uma fonte avulsa (`recurring: false`); ignorado nas recorrentes. */
	month: MonthKey | null;
}

function assertSource(source: IncomeSource): void {
	assertCents(source.amountCents, "amountCents");
	if (source.amountCents <= 0) throw new RangeError(`renda ${source.id}: o valor deve ser positivo`);
	if (!Number.isInteger(source.payday) || source.payday < 1 || source.payday > 31) {
		throw new RangeError(`renda ${source.id}: dia do pagamento inválido: ${source.payday}`);
	}
	if (!source.recurring) {
		if (source.month === null) throw new RangeError(`renda ${source.id}: a avulsa precisa de um mês`);
		parseMonthKey(source.month);
	}
}

/** Quanto entra no mês: a soma das fontes recorrentes mais as avulsas daquele mês. */
export function incomeForMonth(sources: readonly IncomeSource[], month: MonthKey): Cents {
	parseMonthKey(month);
	for (const s of sources) assertSource(s);
	return sumCents(sources.filter((s) => s.recurring || s.month === month).map((s) => s.amountCents));
}

/** O dia do pagamento no mês (31 em fevereiro cai no dia 28/29). */
export function paydayIn(month: MonthKey, payday: number): LocalDate {
	return clampDayInMonth(month, payday);
}

export interface NextPayday {
	sourceId: string;
	date: LocalDate;
	/** 0 = hoje. */
	daysUntil: number;
}

/**
 * O próximo pagamento de hoje em diante (hoje incluso). Empate no dia: o de maior valor, depois o id.
 * `null` sem nenhuma fonte a receber (só avulsas já passadas, por exemplo).
 */
export function nextPayday(sources: readonly IncomeSource[], today: LocalDate): NextPayday | null {
	parseLocalDate(today);
	const thisMonth = monthOf(today);
	let best: (NextPayday & { amountCents: Cents }) | null = null;
	for (const s of sources) {
		assertSource(s);
		const months = s.recurring ? [thisMonth, addMonths(thisMonth, 1)] : [s.month as MonthKey];
		const date = months.map((m) => paydayIn(m, s.payday)).find((d) => d >= today);
		if (date === undefined) continue;
		const wins =
			best === null ||
			date < best.date ||
			(date === best.date &&
				(s.amountCents > best.amountCents || (s.amountCents === best.amountCents && s.id < best.sourceId)));
		if (wins)
			best = { sourceId: s.id, date, daysUntil: daysBetween(today, date), amountCents: s.amountCents };
	}
	return best === null ? null : { sourceId: best.sourceId, date: best.date, daysUntil: best.daysUntil };
}
