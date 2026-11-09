/*
 * Leituras que juntam as stores e o engine: resumo do mês, fatura, relatório do mês, metas e o limite de gasto
 * com a IA. A API e o worker usam as MESMAS funções, então um aviso do worker bate com o número que a tela mostra.
 */

export { createAgentReader } from "./agent-reader.ts";
export { budgetBlock, limitMessage } from "./ai-budget.ts";
export { toCardDto, toPostingDto, toRecurrenceDto, toTransactionDto } from "./dto.ts";
export {
	type GoalClock,
	goalDetail,
	listGoals,
	toContributionDto,
	toGoalDto,
} from "./goals.ts";
export { incomeOverview, toCoreIncome, toIncomeSourceDto } from "./income.ts";
export {
	applyIncomePlan,
	buildIncomePlan,
	cappedSuggestion,
	FIXED_CATEGORY_SLUGS,
	fitBudgetLimits,
	NON_SPENDING_SLUGS,
	restoreBudgets,
} from "./income-plan.ts";
export {
	type CardInvoicesLine,
	type InvoiceLine,
	type InvoicesOverview,
	invoiceOwedCents,
	invoicesOverview,
} from "./invoices-overview.ts";
export { reportForMonth } from "./report.ts";
export { loadSetupAnalysis, STALE_SETUP_MESSAGE, verifyAgainstAnalysis } from "./setup.ts";
export {
	analyzeHistory,
	SETUP_INCOME_MIN_OCCURRENCES,
	SETUP_MAX_CANDIDATES,
	SETUP_MAX_RECURRING,
	SETUP_MIN_GROUP_COUNT,
	type SetupAnalysisInput,
	type SetupTransaction,
} from "./setup-analysis.ts";
export { applySetup, undoSetup } from "./setup-apply.ts";
export {
	activeInstallments,
	cardInvoice,
	categoryForSummary,
	monthSummary,
	refundOriginalsOutside,
	spendingBreakdown,
	toCoreTransaction,
} from "./summary.ts";
export { decodeCursor, encodeCursor, listRecentPage } from "./transaction-list.ts";
