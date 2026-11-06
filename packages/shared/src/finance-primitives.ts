import { z } from "zod";

/** Colunas de valor são `Int` (32 bits) no Postgres: R$ 21.474.836,47 é o teto de um valor. */
export const MAX_CENTS = 2_147_483_647;
/** Igual a `MAX_INSTALLMENTS` de `@orbita/core` (um teste do db garante). */
export const MAX_INSTALLMENT_COUNT = 72;

export const ACCOUNT_KINDS = ["checking", "savings", "wallet", "investment"] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

/** Mesmos nomes do `ClosingRule` do engine (`@orbita/core`). No banco o enum usa underscore. */
export const CLOSING_RULES = ["closing-day-next", "closing-day-included"] as const;
export type ClosingRuleValue = (typeof CLOSING_RULES)[number];

export const TRANSACTION_KINDS = ["expense", "income", "transfer", "card_payment", "refund"] as const;
export type TransactionKindValue = (typeof TRANSACTION_KINDS)[number];

export const TRANSACTION_STATUSES = ["pending", "confirmed"] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const TRANSACTION_SOURCES = ["manual", "notification", "pluggy", "receipt", "import"] as const;
export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];

export const RECURRENCE_KINDS = ["expense", "income"] as const;
export type RecurrenceKindValue = (typeof RECURRENCE_KINDS)[number];

/** Anos aceitos em datas e meses: dentro disso o engine nunca recebe entrada fora do seu alcance. */
export const MIN_YEAR = 1900;
export const MAX_YEAR = 2199;
const yearInRange = (y: number) => y >= MIN_YEAR && y <= MAX_YEAR;

/** Sem mexer em timezone: confere só o calendário ("2026-02-30" não existe) e o ano (1900 a 2199). */
export function isLocalDate(value: unknown): value is string {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const [y, m, d] = value.split("-").map(Number) as [number, number, number];
	if (!yearInRange(y)) return false;
	const probe = new Date(Date.UTC(y, m - 1, d));
	return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

export function isMonthKey(value: unknown): value is string {
	return (
		typeof value === "string" &&
		/^\d{4}-(0[1-9]|1[0-2])$/.test(value) &&
		yearInRange(Number(value.slice(0, 4)))
	);
}

export const isCents = (value: unknown): value is number => Number.isSafeInteger(value);

export const localDateSchema = z
	.string()
	.refine(isLocalDate, "Data inválida (use AAAA-MM-DD, de 1900 a 2199).");
export const monthKeySchema = z.string().refine(isMonthKey, "Mês inválido (use AAAA-MM, de 1900 a 2199).");
/** Centavos inteiros, positivos. A API nunca recebe reais com vírgula. */
export const positiveCentsSchema = z
	.number("O valor deve ser um número.")
	.int("O valor deve ser inteiro, em centavos.")
	.positive("O valor deve ser maior que zero.")
	.max(MAX_CENTS, "O valor passa do limite aceito.");
export const nonNegativeCentsSchema = z
	.number("O valor deve ser um número.")
	.int("O valor deve ser inteiro, em centavos.")
	.min(0, "O valor não pode ser negativo.")
	.max(MAX_CENTS, "O valor passa do limite aceito.");
export const idSchema = z.string().min(1, "Id inválido.").max(64, "Id inválido.");
export const nameSchema = z.string().trim().min(1, "Informe um nome.").max(60, "O nome passa de 60 letras.");
export const dayOfMonthSchema = z
	.number("O dia deve ser um número.")
	.int("O dia deve ser inteiro.")
	.min(1, "O dia vai de 1 a 31.")
	.max(31, "O dia vai de 1 a 31.");
/** Instante serializado (ISO 8601) nos DTOs. */
export const timestampSchema = z.string();
