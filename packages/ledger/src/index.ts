/*
 * Leituras que juntam as stores e o engine: resumo do mês, fatura, relatório do mês, metas e o limite de gasto
 * com a IA. A API e o worker usam as MESMAS funções, então um aviso do worker bate com o número que a tela mostra.
 */
export { budgetBlock, limitMessage } from "./ai-budget.ts";
export {
	type GoalClock,
	goalDetail,
	listGoals,
	toContributionDto,
	toGoalDto,
} from "./goals.ts";
export { reportForMonth } from "./report.ts";
export {
	activeInstallments,
	cardInvoice,
	categoryForSummary,
	monthSummary,
	refundOriginalsOutside,
	toCoreTransaction,
} from "./summary.ts";
