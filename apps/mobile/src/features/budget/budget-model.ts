import type { Cents } from "@orbita/core";
import { MAX_CENTS } from "@orbita/shared";
import { percentOf } from "../../lib/format.ts";

/*
 * Lógica pura da tela "Orçamento do mês": o limite total e um limite por categoria, o quanto já foi
 * gasto de cada e a requisição. O cálculo de gasto, sobra e "dá pra gastar" é do servidor; aqui só se organiza o que ele devolve.
 */

/** Mesmo valor de `TOTAL_BUDGET_SCOPE` em `@orbita/db` (o app não importa o banco). */
export const TOTAL_SCOPE = "total";

export interface BudgetLike {
	scope: string;
	limitCents: Cents;
}

export interface CategoryLike {
	id: string;
	name: string;
	slug?: string;
	chartSlot: number | null;
	archivedAt: string | null;
}

export interface BudgetRow {
	id: string;
	name: string;
	slug?: string;
	chartSlot: number | null;
	/** `null` = sem limite definido. */
	limitCents: Cents | null;
	spentCents: Cents;
	/** 0..100 da barra (passou do limite = 100). */
	fillPercent: number;
	over: boolean;
	/** Passou do percentual de aviso (e ainda não estourou): o servidor decide, pelo engine. */
	warn: boolean;
}

export function totalLimit(budgets: readonly BudgetLike[]): Cents | null {
	return budgets.find((b) => b.scope === TOTAL_SCOPE)?.limitCents ?? null;
}

/**
 * Uma linha por categoria ativa. Com limite primeiro (na ordem das cores do gráfico), sem limite depois, por nome.
 * Limite de categoria que não existe mais (arquivada) não aparece.
 */
export function budgetRows(
	categories: readonly CategoryLike[],
	budgets: readonly BudgetLike[],
	byCategory: Readonly<Record<string, Cents>>,
	alerts: ReadonlySet<string> = new Set(),
): BudgetRow[] {
	const limits = new Map(budgets.map((b) => [b.scope, b.limitCents]));
	const rows = categories
		.filter((c) => c.archivedAt === null)
		.map<BudgetRow>((c) => {
			const limit = limits.get(c.id) ?? null;
			const spent = Math.max(0, byCategory[c.id] ?? 0);
			return {
				id: c.id,
				name: c.name,
				...(c.slug === undefined ? {} : { slug: c.slug }),
				chartSlot: c.chartSlot,
				limitCents: limit,
				spentCents: spent,
				fillPercent:
					limit === null ? 0 : limit === 0 ? (spent > 0 ? 100 : 0) : Math.min(100, percentOf(spent, limit)),
				over: limit !== null && spent > limit,
				warn: limit !== null && spent <= limit && alerts.has(c.id),
			};
		});
	const slot = (r: BudgetRow) => r.chartSlot ?? 99;
	return rows.sort(
		(a, b) =>
			Number(a.limitCents === null) - Number(b.limitCents === null) ||
			(a.limitCents === null ? 0 : slot(a) - slot(b)) ||
			a.name.localeCompare(b.name, "pt-BR"),
	);
}

/**
 * O gasto do mês que não caiu numa categoria da lista entra em Outros, para a soma das linhas
 * fechar com o "Gasto" do Início. Sem a categoria Outros, as linhas ficam como estão.
 */
export function withUnassignedSpend(rows: readonly BudgetRow[], spentCents: Cents): readonly BudgetRow[] {
	const listed = rows.reduce((sum, row) => sum + row.spentCents, 0);
	const gap = spentCents - listed;
	const index = rows.findIndex((row) => row.name === "Outros");
	if (gap === 0 || index < 0 || gap < 0) return rows;
	return rows.map((row, i) => {
		if (i !== index) return row;
		const spent = row.spentCents + gap;
		const limit = row.limitCents;
		return {
			...row,
			spentCents: spent,
			fillPercent:
				limit === null ? 0 : limit === 0 ? (spent > 0 ? 100 : 0) : Math.min(100, percentOf(spent, limit)),
			over: limit !== null && spent > limit,
			warn: limit !== null && spent <= limit && row.warn,
		};
	});
}

/** Soma dos limites por categoria; serve de aviso quando passa do total do mês. */
export function categoryLimitsSum(rows: readonly BudgetRow[]): Cents {
	return rows.reduce((s, r) => s + (r.limitCents ?? 0), 0);
}

/** Os limites por categoria somam mais que o total do mês? */
export function limitsExceedTotal(rows: readonly BudgetRow[], total: Cents | null): boolean {
	return total !== null && categoryLimitsSum(rows) > total;
}

export function validateLimit(cents: Cents): string | null {
	if (!Number.isInteger(cents) || cents <= 0) return "Informe um valor maior que zero.";
	if (cents > MAX_CENTS) return "O valor passa do limite aceito.";
	return null;
}

export type SetRequest = { scope: string; limitCents: Cents };

export function buildSetRequest(
	scope: string,
	cents: Cents,
): { ok: true; request: SetRequest } | { ok: false; message: string } {
	const message = validateLimit(cents);
	return message ? { ok: false, message } : { ok: true, request: { scope, limitCents: cents } };
}

/** Salvar o limite muda o "Dá pra gastar" do Início e a barra dele: o resumo recarrega junto com a lista de limites. */
export function isAffectedByBudget(queryKey: readonly unknown[], baseUrl: string): boolean {
	return queryKey[0] === baseUrl && (queryKey[1] === "summary" || queryKey[1] === "budgets");
}

/** Percentuais oferecidos em "Avisar quando passar de". */
export const ALERT_PERCENT_OPTIONS = [50, 60, 70, 80, 90, 100] as const;

export const ALERT_CAPTION =
	"O aviso por notificação chega quando as notificações existirem. Por enquanto, ele aparece aqui e no Início.";
export const LEFTOVER_CAPTION = "Só guardo a sua escolha: nenhum dinheiro é movido sozinho.";
export const GOALS_SOON = "Metas: em breve";

export interface SuggestionLike {
	months: number;
	monthsUsed: number;
	totalCents: Cents;
	byCategory: Readonly<Record<string, Cents>>;
}

/**
 * O que "Usar sugestão" grava: o total e um limite por categoria ativa que tem sugestão. Categoria sem sugestão
 * (sem gasto) mantém o limite que já tinha.
 */
export function suggestionRequests(
	suggestion: SuggestionLike,
	categories: readonly CategoryLike[],
): SetRequest[] {
	const out: SetRequest[] = [];
	if (suggestion.totalCents > 0) out.push({ scope: TOTAL_SCOPE, limitCents: suggestion.totalCents });
	for (const c of categories) {
		const cents = suggestion.byCategory[c.id];
		if (c.archivedAt === null && cents !== undefined && cents > 0)
			out.push({ scope: c.id, limitCents: cents });
	}
	return out.filter((r) => validateLimit(r.limitCents) === null);
}

/** Só o que muda algo: limite igual ao atual não precisa de pedido (e, sem nada a mudar, o botão some). */
export function changedByRequests(
	requests: readonly SetRequest[],
	budgets: readonly BudgetLike[],
): SetRequest[] {
	const current = new Map(budgets.map((b) => [b.scope, b.limitCents]));
	return requests.filter((r) => current.get(r.scope) !== r.limitCents);
}

/** Quantos dos limites a trocar já existiam (a troca pede confirmação). */
export function replacedCount(requests: readonly SetRequest[], budgets: readonly BudgetLike[]): number {
	const current = new Set(budgets.map((b) => b.scope));
	return requests.filter((r) => current.has(r.scope)).length;
}

/** "Sugestão da Órbita: R$ 2.800, pela mediana dos últimos 3 meses". `amount` já vem formatado (e mascarado). */
export function suggestionCaption(
	suggestion: Pick<SuggestionLike, "monthsUsed" | "months">,
	amount: string,
): string {
	const { monthsUsed: n, months } = suggestion;
	const basis =
		n === 1
			? "pelo único mês fechado com gastos"
			: n === months
				? `pela mediana dos últimos ${n} meses`
				: `pela mediana dos ${n} últimos meses com gastos`;
	return `Sugestão da Órbita: ${amount}, ${basis}`;
}

/** Texto do aviso de percentual em uma categoria ou no total. */
export const warnText = (percent: number) => `Passou de ${percent}% do limite`;

/** Salvar preferências, limites ou a sugestão mexe no resumo (o aviso) e nas preferências. */
export function isAffectedByPreferences(queryKey: readonly unknown[], baseUrl: string): boolean {
	return queryKey[0] === baseUrl && (queryKey[1] === "summary" || queryKey[1] === "preferences");
}
