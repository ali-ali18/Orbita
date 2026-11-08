import {
	addMonths,
	type Cents,
	DEFAULT_RESERVE_PERCENT,
	incomeForMonth,
	incomePlan,
	type LocalDate,
	type MonthKey,
	monthOf,
	occurrencesInMonth,
	type PlanCommitment,
	projectMissingInstallments,
	SUGGESTION_MONTHS,
	scaleDownToFit,
	toLocalDate,
} from "@orbita/core";
import { DataError, type Stores, TOTAL_BUDGET_SCOPE, toMonthlyRecurrence } from "@orbita/db";
import type { BudgetBefore, BudgetSuggestionResponse, BudgetsChangeResponse, PlanDto } from "@orbita/shared";
import { listGoals } from "./goals.ts";
import { toCoreIncome } from "./income.ts";
import { monthSummary } from "./summary.ts";

/*
 * O plano da renda do mês. Aqui só se JUNTA o que o engine pede (renda, recorrências, parcelas da fatura, histórico,
 * metas); toda conta é de `incomePlan` e `scaleDownToFit` em `@orbita/core`. A API, o chat e o worker usam estas mesmas
 * funções, então o número do card do app é o que a IA lê.
 */

/** Categorias cujo limite, quando já definido no orçamento, vale como compromisso fixo. */
export const FIXED_CATEGORY_SLUGS = ["moradia", "saude"] as const;
/** Investimento não é gasto: fica fora do dia a dia e dos limites. */
export const NON_SPENDING_SLUGS = ["investimentos"] as const;

const PAST_PLAN_MESSAGE = "Só dá para aplicar o plano do mês atual ou de um mês futuro.";

/**
 * Compromissos do mês: recorrências de despesa que caem nele e parcelas que vencem na fatura dele (as já lançadas e
 * as que o banco ainda não lançou). Sem categoria (ou categoria arquivada) cai em Outros.
 */
async function collectCommitments(stores: Stores, month: MonthKey): Promise<PlanCommitment[]> {
	const [recurrences, groups, categories] = await Promise.all([
		stores.recurrences.list(),
		stores.transactions.listInstallmentGroups(addMonths(month, -71)),
		stores.categories.list(),
	]);
	const active = new Set(categories.filter((c) => c.archivedAt === null).map((c) => c.id));
	const outros = categories.find((c) => c.slug === "outros" && c.archivedAt === null)?.id ?? null;
	const category = (id: string | null) => (id !== null && active.has(id) ? id : outros);

	const commitments: PlanCommitment[] = [];
	for (const r of recurrences) {
		if (r.kind !== "expense" || occurrencesInMonth(toMonthlyRecurrence(r), month).length === 0) continue;
		commitments.push({
			id: `rec:${r.id}`,
			name: r.name,
			categoryId: category(r.categoryId),
			amountCents: r.amountCents,
			source: "recurrence",
		});
	}
	const cardIds = new Set<string>();
	for (const group of groups) {
		for (const t of group.installments) {
			if (t.cardId === null) continue;
			cardIds.add(t.cardId);
			if (t.invoiceMonth !== month || t.installmentCount === null || t.installmentCount < 2) continue;
			commitments.push({
				id: `inst:${t.id}`,
				name: t.description,
				categoryId: category(t.categoryId),
				amountCents: t.amountCents,
				source: "installment",
			});
		}
	}
	for (const cardId of [...cardIds].sort()) {
		for (const p of projectMissingInstallments(groups, cardId, month)) {
			const first = groups.find((g) => g.groupId === p.groupId)?.installments[0];
			commitments.push({
				id: `est:${p.groupId}:${p.number}`,
				name: p.description,
				categoryId: category(first?.categoryId ?? null),
				amountCents: p.amountCents,
				source: "installment",
			});
		}
	}
	return commitments;
}

/** O gasto por categoria dos meses fechados antes do mês do plano, com categorias arquivadas somadas em Outros. */
async function historyMonths(
	stores: Stores,
	month: MonthKey,
	today: LocalDate,
	remap: (id: string) => string,
): Promise<Array<Record<string, Cents>>> {
	const base = month < monthOf(today) ? month : monthOf(today);
	const months = Array.from({ length: SUGGESTION_MONTHS }, (_, i) => addMonths(base, -(i + 1)));
	const summaries = await Promise.all(months.map((m) => monthSummary(stores, m, today)));
	return summaries.map((s) => {
		const merged: Record<string, Cents> = {};
		for (const [id, cents] of Object.entries(s.summary.byCategory)) {
			const key = remap(id);
			merged[key] = (merged[key] ?? 0) + cents;
		}
		return merged;
	});
}

/** O plano do mês, com os nomes das categorias e quantos limites do dono seriam trocados ao aplicar. */
export async function buildIncomePlan(
	stores: Stores,
	month: MonthKey,
	today: LocalDate,
	reservePercent: number = DEFAULT_RESERVE_PERCENT,
): Promise<PlanDto> {
	const [sources, categories, budgets, goalList, commitments] = await Promise.all([
		stores.incomeSources.list(),
		stores.categories.list(),
		stores.budgets.list(),
		listGoals(stores, { today, dayOf: (d) => toLocalDate(d) }),
		collectCommitments(stores, month),
	]);
	const active = categories.filter((c) => c.archivedAt === null);
	const activeIds = new Set(active.map((c) => c.id));
	const outros = active.find((c) => c.slug === "outros")?.id ?? null;
	const remap = (id: string) => (activeIds.has(id) ? id : (outros ?? id));
	const idsOf = (slugs: readonly string[]) => active.filter((c) => slugs.includes(c.slug)).map((c) => c.id);
	const fixedIds = new Set(idsOf(FIXED_CATEGORY_SLUGS));

	const fixedBudgets: Record<string, Cents> = {};
	for (const b of budgets) if (fixedIds.has(b.scope)) fixedBudgets[b.scope] = b.limitCents;

	const plan = incomePlan({
		month,
		incomeCents: incomeForMonth(sources.map(toCoreIncome), month),
		commitments,
		fixedBudgets,
		history: await historyMonths(stores, month, today, remap),
		goals: goalList.goals
			.filter((g) => !g.reached)
			.map((g) => ({ id: g.id, name: g.name, monthlyNeededCents: g.monthlyNeededCents })),
		reservePercent,
		excludeCategoryIds: idsOf(NON_SPENDING_SLUGS),
	});

	const names = new Map(active.map((c) => [c.id, c.name]));
	const dto: PlanDto = {
		...plan,
		categories: plan.categories.map((c) => ({ ...c, name: names.get(c.categoryId) ?? "Outros" })),
		replacesCount: 0,
	};
	return { ...dto, replacesCount: plan.feasible ? countReplaced(dto, budgets) : 0 };
}

interface BudgetLike {
	scope: string;
	limitCents: Cents;
}

/** Limites que já existem e mudariam (valor diferente) ou sumiriam (categoria fora do plano). O total conta também. */
function countReplaced(plan: PlanDto, current: readonly BudgetLike[]): number {
	let count = 0;
	for (const b of current) {
		const next = b.scope === TOTAL_BUDGET_SCOPE ? plan.budget.totalCents : plan.budget.byCategory[b.scope];
		if (next === undefined || next !== b.limitCents) count += 1;
	}
	return count;
}

/** O que o orçamento "Usar sugestão" mostra quando há renda: o plano, nunca acima dela. `null` sem renda. */
export async function cappedSuggestion(
	stores: Stores,
	today: LocalDate,
): Promise<BudgetSuggestionResponse | null> {
	const month = monthOf(today);
	const plan = await buildIncomePlan(stores, month, today);
	if (plan.incomeCents === 0) return null;
	const scaled = plan.warnings.find((w) => w.code === "scaled_to_fit");
	return {
		months: SUGGESTION_MONTHS,
		monthsUsed: plan.monthsUsed,
		totalCents: plan.budget.totalCents,
		byCategory: plan.budget.byCategory,
		cap:
			plan.cut && scaled
				? {
						incomeCents: plan.incomeCents,
						wantedCents: plan.cut.wantedCents,
						capCents: plan.cut.capCents,
						message: scaled.message,
					}
				: null,
		warnings: plan.warnings
			.filter((w) => w.code !== "scaled_to_fit" && w.code !== "no_history")
			.map((w) => w.message),
	};
}

const changeResponse = async (stores: Stores, previous: BudgetBefore[]): Promise<BudgetsChangeResponse> => ({
	budgets: (await stores.budgets.list()).map((b) => ({
		scope: b.scope,
		limitCents: b.limitCents,
		updatedAt: b.updatedAt.toISOString(),
	})),
	previous,
});

/** Devolve os limites ao que eram (o Desfazer). `null` apaga o limite. */
export async function restoreBudgets(stores: Stores, previous: readonly BudgetBefore[]): Promise<void> {
	// Categoria primeiro e o total por último: quem olha no meio do caminho nunca vê categorias acima do total.
	const ordered = [...previous].sort(
		(a, b) => Number(a.scope === TOTAL_BUDGET_SCOPE) - Number(b.scope === TOTAL_BUDGET_SCOPE),
	);
	for (const p of ordered) {
		if (p.limitCents === null) await stores.budgets.remove(p.scope);
		else await stores.budgets.set(p.scope, p.limitCents);
	}
}

/**
 * Grava o plano no orçamento: o total e um limite por categoria, com total = soma dos limites. Os limites de
 * categorias fora do plano (ex.: Investimentos) saem, para o orçamento não ficar com categorias acima do total.
 * Trocar ou remover o que o dono já definiu pede `confirm` (como o "Usar sugestão" do app). Devolve o que valia
 * antes, para o Desfazer.
 */
export async function applyIncomePlan(
	stores: Stores,
	month: MonthKey,
	today: LocalDate,
	options: { reservePercent?: number | undefined; confirm?: boolean | undefined } = {},
): Promise<BudgetsChangeResponse> {
	if (month < monthOf(today)) throw new DataError("invalid", PAST_PLAN_MESSAGE);
	const plan = await buildIncomePlan(stores, month, today, options.reservePercent);
	if (!plan.feasible) {
		throw new DataError("invalid", plan.warnings[0]?.message ?? "Não há plano para aplicar neste mês.");
	}
	if (plan.budget.totalCents <= 0) {
		throw new DataError("invalid", "Ainda não há gastos nem compromissos para montar os limites.");
	}
	if (plan.replacesCount > 0 && options.confirm !== true) {
		throw new DataError(
			"duplicate",
			`${plan.replacesCount === 1 ? "1 limite que você definiu seria trocado" : `${plan.replacesCount} limites que você definiu seriam trocados`}. Confirme para continuar.`,
		);
	}

	const current = new Map((await stores.budgets.list()).map((b) => [b.scope, b.limitCents]));
	const target = new Map<string, Cents>([
		[TOTAL_BUDGET_SCOPE, plan.budget.totalCents],
		...Object.entries(plan.budget.byCategory),
	]);
	const previous: BudgetBefore[] = [];
	for (const scope of target.keys()) previous.push({ scope, limitCents: current.get(scope) ?? null });
	const stale = [...current.keys()].filter((scope) => !target.has(scope));
	for (const scope of stale) previous.push({ scope, limitCents: current.get(scope) as Cents });

	try {
		// Categorias antes do total: o orçamento nunca tem categorias somando mais que o total no meio do caminho
		// quando o plano diminui, e o total novo já cobre as categorias quando aumenta.
		for (const [scope, limit] of target)
			if (scope !== TOTAL_BUDGET_SCOPE) await stores.budgets.set(scope, limit);
		await stores.budgets.set(TOTAL_BUDGET_SCOPE, plan.budget.totalCents);
		for (const scope of stale) await stores.budgets.remove(scope);
	} catch (error) {
		await restoreBudgets(stores, previous).catch(() => undefined);
		throw error;
	}
	return changeResponse(stores, previous);
}

/**
 * "Ajustar para caber": reduz os limites das categorias, proporcionalmente, até a soma caber no total do mês. A
 * parte que já é compromisso (assinaturas, parcelas, categorias fixas) não encolhe. Sem mudança, devolve `previous`
 * vazio.
 */
export async function fitBudgetLimits(stores: Stores, today: LocalDate): Promise<BudgetsChangeResponse> {
	const budgets = await stores.budgets.list();
	const total = budgets.find((b) => b.scope === TOTAL_BUDGET_SCOPE);
	if (!total) throw new DataError("invalid", "Defina o total do mês antes de ajustar os limites.");
	const limits = Object.fromEntries(
		budgets.filter((b) => b.scope !== TOTAL_BUDGET_SCOPE).map((b) => [b.scope, b.limitCents]),
	);
	const locked: Record<string, Cents> = {};
	for (const c of await collectCommitments(stores, monthOf(today))) {
		if (c.categoryId !== null) locked[c.categoryId] = (locked[c.categoryId] ?? 0) + c.amountCents;
	}
	const fitted = scaleDownToFit(limits, total.limitCents, locked);
	const previous: BudgetBefore[] = [];
	for (const [scope, limit] of Object.entries(fitted)) {
		if (limit === limits[scope]) continue;
		previous.push({ scope, limitCents: limits[scope] as Cents });
		await stores.budgets.set(scope, limit);
	}
	return changeResponse(stores, previous);
}
