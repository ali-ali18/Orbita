import { formatLocalDate, isValidLocalDate, type LocalDate } from "@orbita/core";

/** Data de calendário válida ou `null`. */
export function buildDate(year: number, month: number, day: number): LocalDate | null {
	if (year < 1900 || year > 2100) return null;
	const date = formatLocalDate(year, month, day);
	return isValidLocalDate(date) ? date : null;
}

/** Ano de 2 dígitos: 00..69 → 2000..2069, 70..99 → 1970..1999. */
const fullYear = (yy: number) => (yy < 70 ? 2000 + yy : 1900 + yy);

/**
 * Data de um extrato. Aceita dd/mm/aaaa, dd-mm-aaaa, dd.mm.aaaa, dd/mm/aa, aaaa-mm-dd, aaaa/mm/dd, aaaammdd e,
 * depois da data, uma hora ("2026-03-15 10:20:00", "2026-03-15T10:20:00Z", OFX "20260315120000[-3:BRT]").
 * Não tenta inverter mês e dia: "03/15/2026" é inválido. `null` se não for uma data de calendário válida.
 */
export function parseStatementDate(raw: string): LocalDate | null {
	const text = raw.trim();
	let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/.exec(text);
	if (m) return buildDate(Number(m[1]), Number(m[2]), Number(m[3]));
	m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[T\s,].*)?$/.exec(text);
	if (m) return buildDate(Number(m[3]), Number(m[2]), Number(m[1]));
	m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})(?:[T\s,].*)?$/.exec(text);
	if (m) return buildDate(fullYear(Number(m[3])), Number(m[2]), Number(m[1]));
	m = /^(\d{4})(\d{2})(\d{2})(?:\d{0,6}(?:\.\d+)?(?:\[.*\])?|[T\s].*)?$/.exec(text);
	if (m) return buildDate(Number(m[1]), Number(m[2]), Number(m[3]));
	return null;
}
