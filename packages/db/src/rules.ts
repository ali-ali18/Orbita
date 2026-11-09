import type { ClosingRule } from "@orbita/core";
import {
	ACCOUNT_KINDS,
	type AccountKind,
	CLOSING_RULES,
	DEFAULT_GOAL_ICON,
	GOAL_CHART_SLOTS,
	GOAL_ICONS,
	type GoalIcon,
	INCOME_ON_CARD_MESSAGE,
	isCents,
	isLocalDate,
	isMonthKey,
	MAX_CENTS,
	TRANSACTION_SOURCES,
	type TransactionSource,
} from "@orbita/shared";
import type { AccountInput } from "./account-store.ts";
import { type CardInput, CLOSING_RULE_SOURCES, type ClosingRuleSource } from "./card-store.ts";
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

/** Valor que o banco informou: centavos inteiros, positivo ou negativo (cheque especial, limite estourado). */
function cleanSignedCents(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || Math.abs(value) > MAX_CENTS) {
		throw invalid(`${label} deve ser um inteiro de centavos.`);
	}
	return value;
}

export const cleanBalance = (value: unknown): number => cleanSignedCents(value, "O saldo");
export const cleanAvailable = (value: unknown): number => cleanSignedCents(value, "O limite disponível");

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
	const closingRuleSource =
		input.closingRuleSource ?? (input.closingRule === undefined ? "default" : "owner");
	if (!CLOSING_RULE_SOURCES.includes(closingRuleSource))
		throw invalid("Origem da regra de fechamento inválida.");
	const last4 = hasValue(input.last4) ? String(input.last4) : null;
	if (last4 !== null && !/^\d{4}$/.test(last4)) throw invalid("Informe os 4 últimos dígitos do cartão.");
	return {
		name: cleanText(input.name, "o nome do cartão"),
		bankCode: optionalText(input.bankCode, "o código do banco", 16),
		last4,
		closingDay: cleanDay(input.closingDay, "O dia de fechamento"),
		dueDay: cleanDay(input.dueDay, "O dia de vencimento"),
		closingRule,
		closingRuleSource,
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
		remindDayBefore: data.remindDayBefore === true,
	};
}

/** Campos da meta (menos a conta, que é conferida contra o banco por quem o tem). */
export function normalizeGoal(data: {
	name: string;
	targetCents: number;
	deadline?: string | null | undefined;
	icon?: GoalIcon | undefined;
	chartSlot?: number | undefined;
}) {
	const icon = data.icon ?? DEFAULT_GOAL_ICON;
	if (!GOAL_ICONS.includes(icon)) throw invalid("Ícone de meta inválido.");
	const chartSlot = data.chartSlot ?? 0;
	if (!Number.isInteger(chartSlot) || chartSlot < 0 || chartSlot >= GOAL_CHART_SLOTS) {
		throw invalid("A cor da meta vai de 0 a 9.");
	}
	return {
		name: cleanText(data.name, "o nome da meta"),
		targetCents: cleanCents(data.targetCents, "O valor da meta", 1),
		deadline: hasValue(data.deadline) ? cleanLocalDate(data.deadline, "A data do prazo") : null,
		icon,
		chartSlot,
	};
}

/**
 * Campos da fonte de renda (a conta é conferida contra o banco por quem o tem). Recorrente não tem mês; avulsa
 * precisa de um.
 */
export function normalizeIncomeSource(data: {
	name: string;
	amountCents: number;
	payday: number;
	recurring?: boolean | undefined;
	month?: string | null | undefined;
}) {
	const recurring = data.recurring ?? true;
	if (typeof recurring !== "boolean") throw invalid("Informe se a renda é todo mês ou avulsa.");
	let month: string | null = null;
	if (!recurring) {
		if (!hasValue(data.month)) throw invalid("Informe o mês da renda avulsa.");
		if (!isMonthKey(data.month)) throw invalid("O mês da renda é inválido (use AAAA-MM).");
		month = data.month;
	}
	return {
		name: cleanText(data.name, "o nome da renda"),
		amountCents: cleanCents(data.amountCents, "O valor da renda", 1),
		payday: cleanDay(data.payday, "O dia do pagamento"),
		recurring,
		month,
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

/** Aplica o patch do cartão: trocar a regra sem dizer a origem é escolha do dono, que o sync nunca desfaz. */
export function applyCardPatch<T extends { closingRuleSource: ClosingRuleSource }>(
	current: T,
	patch: Partial<T> & { closingRule?: ClosingRule },
): T {
	const next = applyPatch(current, patch);
	if (patch.closingRule !== undefined && patch.closingRuleSource === undefined)
		next.closingRuleSource = "owner";
	return next;
}
