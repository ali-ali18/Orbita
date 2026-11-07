import { addDays, type Cents, type LocalDate } from "@orbita/core";
import { amountSignMode, signedAmount, type TransactionLike } from "../summary/transaction-model.ts";

export type ActivityFilter = "all" | "out" | "in" | "card";

export const ACTIVITY_FILTERS: readonly { id: ActivityFilter; label: string }[] = [
	{ id: "all", label: "Tudo" },
	{ id: "out", label: "Saídas" },
	{ id: "in", label: "Entradas" },
	{ id: "card", label: "Cartão" },
];

/** Tamanho da página pedida à API (o máximo dela é 100). */
export const PAGE_SIZE = 30;

export interface ActivityTransaction extends TransactionLike {
	id: string;
	description: string;
	categoryId: string | null;
}

/** Saída = despesa; entrada = receita e estorno. Pagamento de fatura e transferência não são nenhum dos dois. */
export function matchesFilter(t: Pick<TransactionLike, "kind" | "cardId">, filter: ActivityFilter): boolean {
	switch (filter) {
		case "all":
			return true;
		case "out":
			return t.kind === "expense";
		case "in":
			return t.kind === "income" || t.kind === "refund";
		case "card":
			return t.cardId !== null;
	}
}

function fold(text: string): string {
	return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");
}

/**
 * Busca por nome, categoria ou valor (sobre o que já foi carregado). Sem texto, tudo passa.
 * Valor: os dígitos digitados precisam aparecer nos centavos ("46" acha R$ 46,90 e R$ 146,00).
 */
export function matchesQuery(
	t: Pick<ActivityTransaction, "description" | "amountCents">,
	categoryName: string | undefined,
	query: string,
): boolean {
	const q = fold(query.trim());
	if (q === "") return true;
	if (fold(t.description).includes(q)) return true;
	if (categoryName && fold(categoryName).includes(q)) return true;
	const digits = q.replace(/\D/g, "");
	return digits !== "" && String(t.amountCents).includes(digits);
}

const WEEKDAYS = [
	"Domingo",
	"Segunda-feira",
	"Terça-feira",
	"Quarta-feira",
	"Quinta-feira",
	"Sexta-feira",
	"Sábado",
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

/** Dia da semana (0 = domingo) de uma data de calendário, sem depender do fuso do aparelho. */
export function weekdayOf(date: LocalDate): number {
	return new Date(
		Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))),
	).getUTCDay();
}

/** "Hoje", "Ontem" ou "Terça-feira, 3 de nov" (com o ano quando não é o de hoje). */
export function dayLabel(date: LocalDate, today: LocalDate): string {
	if (date === today) return "Hoje";
	if (date === addDays(today, -1)) return "Ontem";
	const day = Number(date.slice(8, 10));
	const month = MONTHS_SHORT[Number(date.slice(5, 7)) - 1] ?? "";
	const year = date.slice(0, 4) === today.slice(0, 4) ? "" : ` de ${date.slice(0, 4)}`;
	return `${WEEKDAYS[weekdayOf(date)] ?? ""}, ${day} de ${month}${year}`;
}

/**
 * Saldo do dia: soma com sinal de gastos e entradas. Transferência e pagamento de fatura só movem
 * dinheiro entre contas suas e ficam fora (o valor aparece na linha, sem sinal).
 */
export function dayTotal(items: readonly Pick<TransactionLike, "kind" | "amountCents">[]): Cents {
	let total = 0;
	for (const t of items) {
		if (amountSignMode(t.kind) === "never") continue;
		total += signedAmount(t);
	}
	return total;
}

export interface DayGroup<T> {
	date: LocalDate;
	label: string;
	items: T[];
	total: Cents;
}

/**
 * Agrupa por dia de calendário (a data do lançamento já é a de São Paulo), dias do mais novo para o mais
 * velho; dentro do dia vale a ordem em que a API mandou. Datas iguais que não vieram juntas caem no mesmo grupo.
 */
export function groupByDay<T extends Pick<TransactionLike, "kind" | "amountCents" | "date">>(
	items: readonly T[],
	today: LocalDate,
): DayGroup<T>[] {
	const byDate = new Map<LocalDate, T[]>();
	for (const t of items) {
		const list = byDate.get(t.date);
		if (list) list.push(t);
		else byDate.set(t.date, [t]);
	}
	return [...byDate.entries()]
		.sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
		.map(([date, list]) => ({ date, label: dayLabel(date, today), items: list, total: dayTotal(list) }));
}

/** Junta as páginas já carregadas sem repetir lançamento (uma página nova pode trazer um que já veio). */
export function flattenPages<T extends { id: string }>(
	pages: readonly { transactions: readonly T[] }[],
): T[] {
	const seen = new Set<string>();
	const out: T[] = [];
	for (const page of pages) {
		for (const t of page.transactions) {
			if (seen.has(t.id)) continue;
			seen.add(t.id);
			out.push(t);
		}
	}
	return out;
}

/** "Delivery · Nubank ••••0695 · 2/3". Pendente não entra aqui: tem selo próprio. */
export function activityCaption(
	t: Pick<TransactionLike, "cardId" | "accountId" | "installmentNumber" | "installmentCount">,
	categoryName: string | undefined,
	sources: {
		accounts: ReadonlyMap<string, { name: string }>;
		cards: ReadonlyMap<string, { name: string; last4: string | null }>;
	},
): string {
	const parts: string[] = [];
	if (categoryName) parts.push(categoryName);
	const card = t.cardId ? sources.cards.get(t.cardId) : undefined;
	const account = t.accountId ? sources.accounts.get(t.accountId) : undefined;
	if (card) parts.push(card.last4 ? `${card.name} ••••${card.last4}` : card.name);
	else if (account) parts.push(account.name);
	if (t.installmentNumber !== null && t.installmentCount !== null) {
		parts.push(`${t.installmentNumber}/${t.installmentCount}`);
	}
	return parts.join(" · ");
}

/** Mensagem de lista vazia: com busca ou filtro o motivo é outro (e há o que fazer). */
export function emptyMessage(filter: ActivityFilter, query: string, hasMore: boolean): string {
	if (query.trim() !== "") {
		return hasMore
			? "Nada encontrado entre os lançamentos já carregados. Role a lista para carregar mais."
			: "Nenhum lançamento encontrado.";
	}
	if (filter === "all") return "Nenhum lançamento por aqui ainda.";
	return hasMore
		? "Nenhum lançamento desse tipo entre os já carregados. Role a lista para carregar mais."
		: "Nenhum lançamento desse tipo.";
}
