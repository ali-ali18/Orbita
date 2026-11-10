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

/** "nov" para "2026-11" (ou para uma data "2026-11-07"). */
export function monthShort(date: string): string {
	return MONTHS_SHORT[Number(date.slice(5, 7)) - 1] ?? date;
}

/** Data e hora de um instante ISO no fuso de São Paulo. `null` se o texto não é uma data. */
export function saoPauloStamp(iso: string): { date: LocalDate; time: string } | null {
	const instant = new Date(iso);
	if (Number.isNaN(instant.getTime())) return null;
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: "America/Sao_Paulo",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(instant);
	const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
	const year = get("year");
	const month = get("month");
	const day = get("day");
	const hour = get("hour");
	const minute = get("minute");
	if (!year || !month || !day || hour === undefined || minute === undefined) return null;
	return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}` };
}

/** "12:40" no dia, "ontem, 22:10" no dia anterior, "3 out, 09:12" antes disso. */
export function arrivedLabel(iso: string, today: LocalDate): string {
	const stamp = saoPauloStamp(iso);
	if (!stamp) return "";
	const day = relativeDate(stamp.date, today);
	if (day === "Hoje") return stamp.time;
	return `${day.toLocaleLowerCase("pt-BR")}, ${stamp.time}`;
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

/** "7 de nov" para "2026-11-07" (sem "Hoje"/"Ontem": é para datas de fatura). */
export function dayMonth(date: LocalDate): string {
	const month = MONTHS_SHORT[Number(date.slice(5, 7)) - 1] ?? "";
	return `${Number(date.slice(8, 10))} de ${month}`;
}

/** "agosto de 2027" para "2027-08". */
export function monthYear(month: string): string {
	return `${monthName(month).toLocaleLowerCase("pt-BR")} de ${month.slice(0, 4)}`;
}
