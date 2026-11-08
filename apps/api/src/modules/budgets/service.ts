import { addMonths, type LocalDate, monthOf, SUGGESTION_MONTHS, suggestBudget } from "@orbita/core";
import type { Stores } from "@orbita/db";
import type { BudgetSuggestionResponse } from "@orbita/shared";
import { monthSummary } from "../summary/service.ts";

/**
 * Sugestão da Órbita: a mediana do gasto por categoria nos últimos meses FECHADOS (o mês corrente, incompleto, fica
 * de fora). O gasto de cada mês é o mesmo do Início (`monthSummary`); a conta é do engine, nunca da IA.
 */
export async function budgetSuggestion(stores: Stores, today: LocalDate): Promise<BudgetSuggestionResponse> {
	const current = monthOf(today);
	const months = Array.from({ length: SUGGESTION_MONTHS }, (_, i) => addMonths(current, -(i + 1)));
	const summaries = await Promise.all(months.map((m) => monthSummary(stores, m, today)));
	const result = suggestBudget(summaries.map((s) => s.summary.byCategory));
	return { months: months.length, ...result };
}
