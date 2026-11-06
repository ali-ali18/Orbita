import { addDays, type Cents, formatBRL, type LocalDate } from "@orbita/core";

/** O que aparece no lugar de um valor quando o olho está fechado. */
export const HIDDEN_VALUE = "••••";

/** Esconde um texto de valor (dinheiro) quando `hidden`. Percentual e datas não passam por aqui. */
export function maskValue(text: string, hidden: boolean): string {
	return hidden ? HIDDEN_VALUE : text;
}

export function money(
	cents: Cents,
	hidden: boolean,
	options?: { sign?: "auto" | "always" | "never" },
): string {
	return maskValue(formatBRL(cents, options), hidden);
}

/** "R$ 53" (reais cheios, arredondado, só com inteiros). Para "≈ R$ 53 por dia". */
export function formatWholeReais(cents: Cents): string {
	const sign = cents < 0 ? -1 : 1;
	const rounded = sign * Math.trunc((Math.abs(cents) + 50) / 100) * 100;
	return formatBRL(rounded).replace(/,00$/, "");
}

/** Percentual inteiro de `part` sobre `total`, só com inteiros. 0 se não há total. */
export function percentOf(part: Cents, total: Cents): number {
	if (total <= 0) return 0;
	return Math.round((part * 100) / total);
}

const MONTHS_LONG = [
	"Janeiro",
	"Fevereiro",
	"Março",
	"Abril",
	"Maio",
	"Junho",
	"Julho",
	"Agosto",
	"Setembro",
	"Outubro",
	"Novembro",
	"Dezembro",
] as const;
const MONTHS_SHORT = [
	"jan",
	"fev",
	"mar",
	"abr",
	"mai",
	"jun",
	"jul",
	"ago",
	"set",
	"out",
	"nov",
	"dez",
] as const;

/** "Novembro" para "2026-11". */
export function monthName(month: string): string {
	const index = Number(month.slice(5, 7)) - 1;
	return MONTHS_LONG[index] ?? month;
}

/** "Hoje", "Ontem" ou "5 nov". `today` e `date` são datas de calendário ("YYYY-MM-DD"). */
export function relativeDate(date: LocalDate, today: LocalDate): string {
	if (date === today) return "Hoje";
	if (date === addDays(today, -1)) return "Ontem";
	const day = Number(date.slice(8, 10));
	const month = MONTHS_SHORT[Number(date.slice(5, 7)) - 1] ?? "";
	return `${day} ${month}`;
}

export function greetingFor(hour: number): string {
	if (hour < 5) return "Boa noite";
	if (hour < 12) return "Bom dia";
	if (hour < 18) return "Boa tarde";
	return "Boa noite";
}

export function pluralDays(n: number): string {
	return n === 1 ? "1 dia" : `${n} dias`;
}
