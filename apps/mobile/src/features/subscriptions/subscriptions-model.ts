import {
	type Cents,
	daysBetween,
	type LocalDate,
	type MonthKey,
	nextOccurrence,
	occurrencesInMonth,
} from "@orbita/core";
import { MAX_CENTS, type RecurrenceCreateBody, type RecurrenceUpdateBody } from "@orbita/shared";
import { pluralDays } from "../../lib/format.ts";

/*
 * Lógica pura da tela "Assinaturas": quais recorrências são assinaturas, quanto pesam por mês, se a
 * do mês já foi lançada e o corpo da requisição. Nenhuma conta de fatura: isso é do servidor.
 */

export interface RecurrenceLike {
	id: string;
	kind: "expense" | "income";
	name: string;
	amountCents: Cents;
	dayOfMonth: number;
	startDate: LocalDate;
	endDate: LocalDate | null;
	categoryId: string | null;
	accountId: string | null;
	cardId: string | null;
	remindDayBefore: boolean;
	archivedAt: string | null;
}

export interface MonthTransactionLike {
	kind: string;
	description: string;
	accountId: string | null;
	cardId: string | null;
}

/** Assinatura = despesa recorrente ainda ativa. Receita (salário) e arquivada ficam de fora. */
export function isSubscription(r: Pick<RecurrenceLike, "kind" | "archivedAt">): boolean {
	return r.kind === "expense" && r.archivedAt === null;
}

const rule = (r: RecurrenceLike) => ({
	dayOfMonth: r.dayOfMonth,
	startDate: r.startDate,
	...(r.endDate ? { endDate: r.endDate } : {}),
});

/** A próxima cobrança na data `today` ou depois; `null` se a assinatura já terminou. */
export function nextCharge(r: RecurrenceLike, today: LocalDate): LocalDate | null {
	return nextOccurrence(rule(r), today) ?? null;
}

/** Cai neste mês (início e fim valem)? */
export function chargesIn(r: RecurrenceLike, month: MonthKey): boolean {
	return occurrencesInMonth(rule(r), month).length > 0;
}

/** Assinaturas ativas, da cobrança mais próxima para a mais distante; as já encerradas vão pro fim. */
export function sortSubscriptions(list: readonly RecurrenceLike[], today: LocalDate): RecurrenceLike[] {
	const key = (r: RecurrenceLike) => nextCharge(r, today) ?? "9999-12-31";
	return list
		.filter(isSubscription)
		.sort((a, b) => key(a).localeCompare(key(b)) || a.name.localeCompare(b.name, "pt-BR"));
}

export type MonthStatus = "posted" | "pending" | "none";

const norm = (s: string) => s.trim().toLocaleLowerCase("pt-BR");

/**
 * A API não diz qual recorrência já virou lançamento no mês; o lançamento criado por "Lançar agora"
 * leva o nome dela, o mesmo tipo e a mesma conta/cartão. É o que se confere aqui. Se o usuário renomeou
 * o lançamento, a assinatura aparece como pendente e o servidor responde 409 ao tentar lançar de novo.
 */
export function wasPosted(r: RecurrenceLike, monthTransactions: readonly MonthTransactionLike[]): boolean {
	return monthTransactions.some(
		(t) =>
			t.kind === r.kind &&
			norm(t.description) === norm(r.name) &&
			t.accountId === r.accountId &&
			t.cardId === r.cardId,
	);
}

export function monthStatus(
	r: RecurrenceLike,
	month: MonthKey,
	monthTransactions: readonly MonthTransactionLike[],
): MonthStatus {
	if (!chargesIn(r, month)) return "none";
	return wasPosted(r, monthTransactions) ? "posted" : "pending";
}

export interface PendingSummary {
	ids: string[];
	count: number;
	totalCents: Cents;
}

/** O que falta lançar neste mês: quais assinaturas, quantas e a soma em centavos inteiros. */
export function pendingSummary(
	list: readonly RecurrenceLike[],
	month: MonthKey,
	monthTransactions: readonly MonthTransactionLike[],
): PendingSummary {
	const pending = list.filter(
		(r) => isSubscription(r) && monthStatus(r, month, monthTransactions) === "pending",
	);
	return {
		ids: pending.map((r) => r.id),
		count: pending.length,
		totalCents: pending.reduce((sum, r) => sum + r.amountCents, 0),
	};
}

/** "3 para lançar este mês"; o valor entra à parte, formatado (e escondido pelo olho). */
export function pendingLabel(count: number): string {
	return `${count} para lançar este mês`;
}

export interface BatchPostResult {
	/** Lançamentos criados agora (base do "Desfazer"). */
	transactionIds: string[];
	/** 409: já estavam lançadas. */
	already: number;
	failed: number;
}

/** Confirmação depois de "Lançar todas". */
export function batchMessage(r: BatchPostResult): string {
	const posted = r.transactionIds.length;
	const parts: string[] = [];
	if (posted > 0) parts.push(posted === 1 ? "1 assinatura lançada." : `${posted} assinaturas lançadas.`);
	if (r.already > 0)
		parts.push(r.already === 1 ? "1 já estava lançada." : `${r.already} já estavam lançadas.`);
	if (r.failed > 0)
		parts.push(
			r.failed === 1
				? "Não consegui lançar 1. Tente de novo."
				: `Não consegui lançar ${r.failed}. Tente de novo.`,
		);
	return parts.join(" ") || "Nada para lançar.";
}

/** "Todo dia 12 · em 6 dias", "Todo dia 4 · lançada", "Todo dia 3 · pendente". */
export function chargeCaption(
	r: RecurrenceLike,
	status: MonthStatus,
	today: LocalDate,
	month: MonthKey,
): string {
	const base = `Todo dia ${r.dayOfMonth}`;
	if (status === "posted") return `${base} · lançada`;
	if (status === "pending") {
		const [date] = occurrencesInMonth(rule(r), month);
		if (date !== undefined && date < today) return `${base} · pendente`;
	}
	const next = nextCharge(r, today);
	if (next === null) return `${base} · encerrada`;
	const days = daysBetween(today, next);
	return days <= 0 ? `${base} · hoje` : `${base} · em ${pluralDays(days)}`;
}

/** "Próxima: Google One, dia 12 · em 6 dias"; `null` sem nenhuma cobrança futura. */
export function nextSummary(list: readonly RecurrenceLike[], today: LocalDate): string | null {
	let best: { r: RecurrenceLike; date: LocalDate } | null = null;
	for (const r of list.filter(isSubscription)) {
		const date = nextCharge(r, today);
		if (date !== null && (best === null || date < best.date)) best = { r, date };
	}
	if (!best) return null;
	const days = daysBetween(today, best.date);
	const when = days <= 0 ? "hoje" : `em ${pluralDays(days)}`;
	return `Próxima: ${best.r.name}, dia ${Number(best.date.slice(8, 10))} · ${when}`;
}

export function countLabel(n: number): string {
	return n === 1 ? "1 assinatura" : `${n} assinaturas`;
}

// ------------------------------------------------------------- formulário

export interface SubscriptionForm {
	name: string;
	amountCents: Cents;
	dayOfMonth: number;
	/** `account:<id>` ou `card:<id>`; `null` = vale a primeira da lista. */
	sourceKey: string | null;
	/** "Lembrar 1 dia antes": só a escolha é guardada; o aviso espera as notificações push existirem. */
	remindDayBefore: boolean;
	/** Categoria padrão do serviço do catálogo, por nome; `null` = "Assinaturas". */
	categoryName: string | null;
}

export function initialForm(today: LocalDate): SubscriptionForm {
	return {
		name: "",
		amountCents: 0,
		dayOfMonth: Number(today.slice(8, 10)),
		sourceKey: null,
		remindDayBefore: false,
		categoryName: null,
	};
}

export function formFromRecurrence(r: RecurrenceLike): SubscriptionForm {
	return {
		name: r.name,
		amountCents: r.amountCents,
		dayOfMonth: r.dayOfMonth,
		sourceKey: r.cardId ? `card:${r.cardId}` : r.accountId ? `account:${r.accountId}` : null,
		remindDayBefore: r.remindDayBefore,
		// Na edição a categoria da assinatura não muda: só um serviço escolhido agora a define.
		categoryName: null,
	};
}

export interface SourcePick {
	type: "account" | "card";
	id: string;
}

export function parseSourceKey(key: string | null | undefined): SourcePick | null {
	if (!key) return null;
	const [type, ...rest] = key.split(":");
	const id = rest.join(":");
	if ((type !== "account" && type !== "card") || id === "") return null;
	return { type, id };
}

export function validateForm(form: SubscriptionForm, source: SourcePick | null): string | null {
	if (form.name.trim() === "") return "Informe o nome da assinatura.";
	if (form.name.trim().length > 60) return "O nome passa de 60 letras.";
	if (!Number.isInteger(form.amountCents) || form.amountCents <= 0) return "Informe o valor da cobrança.";
	if (form.amountCents > MAX_CENTS) return "O valor passa do limite aceito.";
	if (!Number.isInteger(form.dayOfMonth) || form.dayOfMonth < 1 || form.dayOfMonth > 31)
		return "O dia vai de 1 a 31.";
	if (!source) return "Escolha a conta ou o cartão da cobrança.";
	return null;
}

/** Interpreta o que foi digitado no campo de dia ("" e fora de 1..31 viram `null`). */
export function parseDay(text: string): number | null {
	const digits = text.replace(/\D/g, "");
	if (digits === "") return null;
	const n = Number(digits);
	return n >= 1 && n <= 31 ? n : null;
}

export type SaveRequest =
	| { type: "create"; body: RecurrenceCreateBody }
	| { type: "update"; id: string; body: RecurrenceUpdateBody };

/**
 * Corpo da requisição. A assinatura nova vale a partir de hoje: não reserva no orçamento uma cobrança
 * de dias atrás que o usuário já pagou por fora. A categoria "Assinaturas", se existe, entra sozinha.
 */
export function buildRequest(input: {
	form: SubscriptionForm;
	source: SourcePick | null;
	today: LocalDate;
	categoryId: string | null;
	editingId: string | null;
}): { ok: true; request: SaveRequest } | { ok: false; message: string } {
	const { form, source, today, categoryId, editingId } = input;
	const message = validateForm(form, source);
	if (message || !source) return { ok: false, message: message ?? "Escolha a conta ou o cartão." };
	const where =
		source.type === "card" ? { cardId: source.id, accountId: null } : { accountId: source.id, cardId: null };
	if (editingId) {
		return {
			ok: true,
			request: {
				type: "update",
				id: editingId,
				body: {
					name: form.name.trim(),
					amountCents: form.amountCents,
					dayOfMonth: form.dayOfMonth,
					remindDayBefore: form.remindDayBefore,
					...where,
				},
			},
		};
	}
	return {
		ok: true,
		request: {
			type: "create",
			body: {
				kind: "expense",
				name: form.name.trim(),
				amountCents: form.amountCents,
				dayOfMonth: form.dayOfMonth,
				startDate: today,
				remindDayBefore: form.remindDayBefore,
				...(categoryId ? { categoryId } : {}),
				...where,
			},
		},
	};
}

/** Categoria "Assinaturas" (sem acento e sem caixa), se o usuário tem uma ativa. */
export function subscriptionsCategoryId(
	categories: readonly { id: string; name: string; archivedAt: string | null }[],
): string | null {
	const plain = (s: string) =>
		s
			.normalize("NFD")
			.replace(/\p{Diacritic}/gu, "")
			.toLowerCase()
			.trim();
	return categories.find((c) => c.archivedAt === null && plain(c.name) === "assinaturas")?.id ?? null;
}

/** O aviso "1 dia antes" ainda não dispara: notificações push não existem. A tela diz isso, sem fingir. */
export const REMINDER_CAPTION =
	"O lembrete vai começar a funcionar quando as notificações chegarem ao Órbita. Por enquanto, só guardo sua escolha.";

/** Toda mudança aqui mexe no que o Início mostra: o resumo (a reserva do mês) e os lançamentos. */
export const SUBSCRIPTION_AFFECTED: ReadonlySet<unknown> = new Set([
	"summary",
	"recurrences",
	"transactions",
	"month-transactions",
	"invoice",
]);

export function isAffectedBySubscription(queryKey: readonly unknown[], baseUrl: string): boolean {
	return queryKey[0] === baseUrl && SUBSCRIPTION_AFFECTED.has(queryKey[1]);
}
