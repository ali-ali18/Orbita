import type { LocalDate, MonthKey } from "./types.ts";

export const DEFAULT_TIME_ZONE = "America/Sao_Paulo";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

const pad = (n: number, width: number) => n.toString().padStart(width, "0");

export function isLeapYear(year: number): boolean {
	return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Mês 1..12. */
export function daysInMonth(year: number, month: number): number {
	if (!Number.isInteger(year) || year < 1 || year > 9999) throw new RangeError(`ano inválido: ${year}`);
	if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError(`mês inválido: ${month}`);
	if (month === 2) return isLeapYear(year) ? 29 : 28;
	return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

export function isValidLocalDate(value: string): boolean {
	const m = typeof value === "string" ? DATE_RE.exec(value) : null;
	if (!m) return false;
	const year = Number(m[1]);
	const month = Number(m[2]);
	const day = Number(m[3]);
	if (year < 1 || month < 1 || month > 12) return false;
	return day >= 1 && day <= daysInMonth(year, month);
}

export function parseLocalDate(value: LocalDate): { year: number; month: number; day: number } {
	if (!isValidLocalDate(value)) throw new RangeError(`data inválida: "${value}"`);
	const m = DATE_RE.exec(value);
	return { year: Number(m?.[1]), month: Number(m?.[2]), day: Number(m?.[3]) };
}

export function formatLocalDate(year: number, month: number, day: number): LocalDate {
	return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

export function parseMonthKey(value: MonthKey): { year: number; month: number } {
	const m = typeof value === "string" ? MONTH_RE.exec(value) : null;
	const year = Number(m?.[1]);
	const month = Number(m?.[2]);
	if (!m || year < 1 || month < 1 || month > 12) throw new RangeError(`mês inválido: "${value}"`);
	return { year, month };
}

export function formatMonthKey(year: number, month: number): MonthKey {
	return `${pad(year, 4)}-${pad(month, 2)}`;
}

/**
 * A data de calendário que `instant` tem no fuso do usuário. Meia-noite UTC ainda é
 * "ontem" em São Paulo; usar `toISOString()` colocaria compras da noite no dia seguinte.
 */
export function toLocalDate(instant: Date, timeZone: string = DEFAULT_TIME_ZONE): LocalDate {
	if (Number.isNaN(instant.getTime())) throw new RangeError("instante inválido");
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(instant);
	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
	return formatLocalDate(get("year"), get("month"), get("day"));
}

export function monthOf(date: LocalDate): MonthKey {
	const { year, month } = parseLocalDate(date);
	return formatMonthKey(year, month);
}

export function addMonths(month: MonthKey, n: number): MonthKey {
	if (!Number.isInteger(n)) throw new RangeError("número de meses deve ser inteiro");
	const { year, month: m } = parseMonthKey(month);
	const index = year * 12 + (m - 1) + n;
	const newYear = Math.floor(index / 12);
	if (newYear < 1 || newYear > 9999) throw new RangeError("mês fora do intervalo suportado");
	return formatMonthKey(newYear, (index % 12) + 1);
}

/** Dia 31 em fevereiro vira o último dia do mês. É o que os bancos fazem. */
export function clampDay(year: number, month: number, day: number): LocalDate {
	if (!Number.isInteger(day) || day < 1 || day > 31) throw new RangeError(`dia inválido: ${day}`);
	return formatLocalDate(year, month, Math.min(day, daysInMonth(year, month)));
}

export function clampDayInMonth(month: MonthKey, day: number): LocalDate {
	const { year, month: m } = parseMonthKey(month);
	return clampDay(year, m, day);
}

/** Dias desde 1970-01-01 (algoritmo de Hinnant), só com inteiros: sem Date, sem fuso. */
function toDayNumber(date: LocalDate): number {
	const { year, month, day } = parseLocalDate(date);
	const y = month <= 2 ? year - 1 : year;
	const era = Math.floor(y / 400);
	const yoe = y - era * 400;
	const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
	const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
	return era * 146097 + doe - 719468;
}

function fromDayNumber(days: number): LocalDate {
	const z = days + 719468;
	const era = Math.floor(z / 146097);
	const doe = z - era * 146097;
	const yoe = Math.floor(
		(doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
	);
	const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
	const mp = Math.floor((5 * doy + 2) / 153);
	const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
	const month = mp < 10 ? mp + 3 : mp - 9;
	const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
	return formatLocalDate(year, month, day);
}

export function addDays(date: LocalDate, n: number): LocalDate {
	if (!Number.isInteger(n)) throw new RangeError("número de dias deve ser inteiro");
	const result = fromDayNumber(toDayNumber(date) + n);
	if (!isValidLocalDate(result)) throw new RangeError("data fora do intervalo suportado");
	return result;
}

/** Datas "YYYY-MM-DD" válidas ordenam como texto; ainda assim valida a entrada. */
export function compareLocalDate(a: LocalDate, b: LocalDate): -1 | 0 | 1 {
	parseLocalDate(a);
	parseLocalDate(b);
	return a < b ? -1 : a > b ? 1 : 0;
}

/** `b - a` em dias (negativo se `b` é anterior). */
export function daysBetween(a: LocalDate, b: LocalDate): number {
	return toDayNumber(b) - toDayNumber(a);
}
