import type { MonthReport } from "./report.ts";
import type { Cents, MonthKey } from "./types.ts";

/*
 * Achados dos agentes Metas, Cofrinho e Fechamento. Cada um só ESCOLHE números que o engine já calculou
 * (`summarizeGoal`, `safeToSpend`/`projectMonth`, `monthReport`); aqui não nasce conta nova de dinheiro, além de
 * somas e diferenças inteiras.
 */

// -------------------------------------------------------------------- Metas

/** O que `summarizeGoal` entregou de uma meta. */
export interface GoalFacts {
	id: string;
	name: string;
	targetCents: Cents;
	savedCents: Cents;
	remainingCents: Cents;
	percent: number;
	status: "reached" | "no_deadline" | "on_track" | "behind";
	deadline: string | null;
	monthsLeft: number | null;
	monthlyNeededCents: Cents | null;
	paceCents: Cents;
	projectedDate: string | null;
}

export interface GoalBehind {
	goalId: string;
	name: string;
	percent: number;
	remainingCents: Cents;
	deadline: string | null;
	monthsLeft: number | null;
	monthlyNeededCents: Cents;
	paceCents: Cents;
	/** O que falta por mês, além do ritmo atual, para chegar no prazo. */
	gapPerMonthCents: Cents;
	projectedDate: string | null;
}

/** Metas atrasadas: a situação (`behind`) é a do engine de metas; aqui só se separa quem precisa de aviso. */
export function goalsBehindPace(goals: readonly GoalFacts[]): GoalBehind[] {
	const found: GoalBehind[] = [];
	for (const g of goals) {
		if (g.status !== "behind" || g.monthlyNeededCents === null) continue;
		found.push({
			goalId: g.id,
			name: g.name,
			percent: g.percent,
			remainingCents: g.remainingCents,
			deadline: g.deadline,
			monthsLeft: g.monthsLeft,
			monthlyNeededCents: g.monthlyNeededCents,
			paceCents: g.paceCents,
			gapPerMonthCents: Math.max(0, g.monthlyNeededCents - g.paceCents),
			projectedDate: g.projectedDate,
		});
	}
	return found.sort((a, b) => b.gapPerMonthCents - a.gapPerMonthCents || (a.name < b.name ? -1 : 1));
}

// ----------------------------------------------------------------- Cofrinho

/** Quanto sugerir guardar vem arredondado para baixo a múltiplos de R$ 10: sugestão redonda e que cabe. */
export const SAVING_ROUND_CENTS = 1000;

export interface SavingSuggestion {
	/** O que sobra do orçamento total no ritmo atual (orçamento menos a projeção do mês). */
	leftoverCents: Cents;
	/** O quanto guardar: a sobra, para baixo, em múltiplos de `SAVING_ROUND_CENTS`. */
	suggestedCents: Cents;
	budgetCents: Cents;
	projectedCents: Cents;
	/** O mês ainda está no começo: a projeção é pouco confiável. */
	lowConfidence: boolean;
}

/**
 * Cofrinho: sugere guardar a sobra projetada do mês, sem tocar em dinheiro nenhum. Os números são do engine:
 * `budgetCents` é o orçamento total do mês e `projectedCents` a projeção de `projectMonth` (já reserva as despesas
 * recorrentes que ainda vão cair). Sem orçamento total, ou com sobra abaixo do mínimo, não há o que sugerir.
 */
export function suggestSaving(input: {
	budgetCents: Cents | null;
	projectedCents: Cents | null;
	lowConfidence: boolean;
	minCents: Cents;
}): SavingSuggestion | null {
	if (input.budgetCents === null || input.projectedCents === null) return null;
	const leftoverCents = input.budgetCents - input.projectedCents;
	if (leftoverCents <= 0) return null;
	const suggestedCents = Math.floor(leftoverCents / SAVING_ROUND_CENTS) * SAVING_ROUND_CENTS;
	if (suggestedCents < Math.max(input.minCents, SAVING_ROUND_CENTS)) return null;
	return {
		leftoverCents,
		suggestedCents,
		budgetCents: input.budgetCents,
		projectedCents: input.projectedCents,
		lowConfidence: input.lowConfidence,
	};
}

// --------------------------------------------------------------- Fechamento

export interface ClosingCategory {
	categoryId: string;
	spentCents: Cents;
	sharePercent: number;
	/** Contra o mês anterior; `null` sem referência. */
	percentChange: number | null;
}

export interface MonthClosing {
	month: MonthKey;
	incomeCents: Cents;
	spentCents: Cents;
	/** Entrou menos saiu (negativo se fechou no vermelho). */
	balanceCents: Cents;
	/** O que sobrou: o saldo, se positivo. */
	leftoverCents: Cents;
	/** Contra o mês anterior; `null` quando o anterior não tem lançamento. */
	spentDeltaCents: Cents | null;
	spentChangePercent: number | null;
	topCategories: ClosingCategory[];
	overBudgetCount: number;
}

export const CLOSING_TOP_CATEGORIES = 3;

/** Fechamento do mês: resume o `monthReport` (que já comparou com o mês anterior). `null` se o mês não teve movimento. */
export function closeMonth(report: MonthReport): MonthClosing | null {
	const { incomeCents, spentCents, balanceCents } = report.totals;
	if (incomeCents === 0 && spentCents === 0) return null;
	return {
		month: report.month,
		incomeCents,
		spentCents,
		balanceCents,
		leftoverCents: Math.max(0, balanceCents),
		spentDeltaCents: report.vsPrevious?.spent.deltaCents ?? null,
		spentChangePercent: report.vsPrevious?.spent.percent ?? null,
		topCategories: report.topCategories.slice(0, CLOSING_TOP_CATEGORIES).map((c) => ({
			categoryId: c.categoryId,
			spentCents: c.spentCents,
			sharePercent: c.sharePercent,
			percentChange: c.percent,
		})),
		overBudgetCount: report.budget.overCount,
	};
}
