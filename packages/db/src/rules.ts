import type { ClosingRule } from "@orbita/core";
import {
	ACCOUNT_KINDS,
	type AccountKind,
	CLOSING_RULES,
	INCOME_ON_CARD_MESSAGE,
	isCents,
	isLocalDate,
	isMonthKey,
	MAX_CENTS,
	TRANSACTION_SOURCES,
	type TransactionSource,
} from "@orbita/shared";
import type { AccountInput } from "./account-store.ts";
import type { CardInput } from "./card-store.ts";
import type { CategoryInput } from "./category-store.ts";
import { invalid } from "./errors.ts";
import type { RecurrenceData } from "./recurrence-store.ts";

/** Normalizadores compartilhados pelos stores Prisma e memória: mesma regra, mesma mensagem. */

const hasValue = (v: unknown) => v !== undefined && v !== null;

export function cleanText(value: unknown, label: string, max = 60): string {
	if (typeof value !== "string" || value.trim().length === 0) throw invalid(`Informe ${label}.`);
	const text = value.trim();
	if (text.length > max) throw invalid(`${label[0]?.toUpperCase()}${label.slice(1)} passa de ${max} letras.`);
	return text;
}

function optionalText(value: unknown, label: string, max: number): string | null {
	return hasValue(value) ? cleanText(value, label, max) : null;
}

export function cleanCents(value: unknown, label: string, min: 0 | 1): number {
	if (!isCents(value) || value < min || value > MAX_CENTS) {
		throw invalid(
			min === 1
				? `${label} deve ser um inteiro positivo, em centavos.`
				: `${label} deve ser um inteiro de centavos, zero ou mais.`,
		);
	}
	return value;
}

function cleanDay(value: unknown, label: string): number {
	if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 31) {
		throw invalid(`${label} deve ser um dia de 1 a 31.`);
	}
	return value as number;
}

export const cleanLocalDate = (value: unknown, label = "A data"): string => {
	if (!isLocalDate(value)) throw invalid(`${label} é inválida (use AAAA-MM-DD).`);
	return value;
};

export const cleanMonth = (value: unknown, label = "O mês"): string => {
	if (!isMonthKey(value)) throw invalid(`${label} é inválido (use AAAA-MM).`);
	return value;
};

/**
 * Origem do cadastro (conta ou cartão). Só `create` grava; `update` nunca mexe, então não entra
 * em `normalizeAccount`/`normalizeCard`.
 */
export function normalizeIdentity(input: {
	source?: TransactionSource | undefined;
	externalId?: string | null | undefined;
}): {
	source: TransactionSource;
	externalId: string | null;
} {
	const source = input.source ?? "manual";
	if (!TRANSACTION_SOURCES.includes(source)) throw invalid("Origem do cadastro inválida.");
	if (source === "manual") {
		if (hasValue(input.externalId)) throw invalid("Cadastro manual não tem identificador externo.");
		return { source, externalId: null };
	}
	if (typeof input.externalId !== "string") throw invalid("Informe o identificador externo.");
	const externalId = input.externalId.trim();
	if (externalId.length === 0 || externalId.length > 200) {
		throw invalid("O identificador externo deve ter de 1 a 200 letras.");
	}
	return { source, externalId };
}

export function normalizeAccount(input: AccountInput) {
	if (!ACCOUNT_KINDS.includes(input.kind as AccountKind)) throw invalid("Tipo de conta inválido.");
	return {
		name: cleanText(input.name, "o nome da conta"),
		kind: input.kind,
		bankCode: optionalText(input.bankCode, "o código do banco", 16),
	};
}

export function normalizeCard(input: CardInput) {
	const closingRule: ClosingRule = input.closingRule ?? "closing-day-next";
	if (!CLOSING_RULES.includes(closingRule)) throw invalid("Regra de fechamento inválida.");
	const last4 = hasValue(input.last4) ? String(input.last4) : null;
	if (last4 !== null && !/^\d{4}$/.test(last4)) throw invalid("Informe os 4 últimos dígitos do cartão.");
	return {
		name: cleanText(input.name, "o nome do cartão"),
		bankCode: optionalText(input.bankCode, "o código do banco", 16),
		last4,
		closingDay: cleanDay(input.closingDay, "O dia de fechamento"),
		dueDay: cleanDay(input.dueDay, "O dia de vencimento"),
		closingRule,
		limitCents: hasValue(input.limitCents) ? cleanCents(input.limitCents, "O limite do cartão", 0) : null,
	};
}

export function normalizeCategory(input: CategoryInput) {
	const slug = cleanText(input.slug, "o identificador da categoria", 40);
	if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
		throw invalid("O identificador da categoria usa letras minúsculas, números e hífen.");
	}
	const chartSlot = input.chartSlot ?? null;
	if (chartSlot !== null && (!Number.isInteger(chartSlot) || chartSlot < 0 || chartSlot > 9)) {
		throw invalid("O espaço no gráfico vai de 0 a 9.");
	}
	return {
		slug,
		name: cleanText(input.name, "o nome da categoria"),
		chartSlot,
		isSystem: input.isSystem ?? false,
	};
}

export function normalizeRecurrence(data: RecurrenceData): RecurrenceData {
	if (data.kind !== "expense" && data.kind !== "income") throw invalid("Tipo de recorrência inválido.");
	const startDate = cleanLocalDate(data.startDate, "A data de início");
	const endDate = hasValue(data.endDate) ? cleanLocalDate(data.endDate, "A data de fim") : null;
	if (endDate !== null && endDate < startDate)
		throw invalid("O fim da recorrência não pode ser antes do início.");
	if (hasValue(data.accountId) === hasValue(data.cardId)) {
		throw invalid("Informe a conta ou o cartão (apenas um dos dois).");
	}
	if (data.kind === "income" && hasValue(data.cardId)) throw invalid(INCOME_ON_CARD_MESSAGE);
	return {
		kind: data.kind,
		name: cleanText(data.name, "o nome da recorrência"),
		amountCents: cleanCents(data.amountCents, "O valor", 1),
		dayOfMonth: cleanDay(data.dayOfMonth, "O dia do mês"),
		startDate,
		endDate,
		categoryId: data.categoryId ?? null,
		accountId: data.accountId ?? null,
		cardId: data.cardId ?? null,
	};
}

/** Aplica um patch ignorando chaves `undefined` (campo ausente = não muda). */
export function applyPatch<T extends object>(current: T, patch: Partial<T>): T {
	const next = { ...current };
	for (const [key, value] of Object.entries(patch)) {
		if (value !== undefined) (next as Record<string, unknown>)[key] = value;
	}
	return next;
}
