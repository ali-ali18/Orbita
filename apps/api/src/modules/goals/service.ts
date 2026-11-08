import { goalsTotals, type LocalDate, summarizeGoal } from "@orbita/core";
import type { GoalContributionRecord, GoalRecord, Stores } from "@orbita/db";
import type { GoalContributionDto, GoalDetailResponse, GoalDto, GoalsListResponse } from "@orbita/shared";

/** Os números de uma meta vêm do engine; aqui só se junta o registro com o resumo. */
export function toGoalDto(
	goal: GoalRecord,
	contributions: readonly GoalContributionRecord[],
	today: LocalDate,
	createdOn: LocalDate,
): GoalDto {
	const summary = summarizeGoal(
		{
			targetCents: goal.targetCents,
			deadline: goal.deadline,
			createdOn,
			contributions: contributions.map((c) => ({ amountCents: c.amountCents, date: c.date })),
		},
		today,
	);
	return {
		id: goal.id,
		name: goal.name,
		targetCents: goal.targetCents,
		deadline: goal.deadline,
		accountId: goal.accountId,
		icon: goal.icon,
		chartSlot: goal.chartSlot,
		archivedAt: goal.archivedAt?.toISOString() ?? null,
		createdAt: goal.createdAt.toISOString(),
		updatedAt: goal.updatedAt.toISOString(),
		...summary,
	};
}

export const toContributionDto = (c: GoalContributionRecord): GoalContributionDto => ({
	id: c.id,
	goalId: c.goalId,
	amountCents: c.amountCents,
	date: c.date,
	transactionId: c.transactionId,
	createdAt: c.createdAt.toISOString(),
});

export interface GoalClock {
	/** Hoje no fuso do dono. */
	today: LocalDate;
	/** O dia de uma data/hora no mesmo fuso. */
	dayOf: (instant: Date) => LocalDate;
}

/** As metas ativas com o resumo do engine e o total guardado. */
export async function listGoals(stores: Stores, clock: GoalClock): Promise<GoalsListResponse> {
	const goals = await stores.goals.list();
	const contributions = await stores.goals.listContributions(goals.map((g) => g.id));
	const byGoal = new Map<string, GoalContributionRecord[]>();
	for (const c of contributions) byGoal.set(c.goalId, [...(byGoal.get(c.goalId) ?? []), c]);
	const dtos = goals.map((g) => toGoalDto(g, byGoal.get(g.id) ?? [], clock.today, clock.dayOf(g.createdAt)));
	return { goals: dtos, totals: goalsTotals(dtos) };
}

/** Uma meta (também arquivada) com as contribuições; `null` se não existe. */
export async function goalDetail(
	stores: Stores,
	id: string,
	clock: GoalClock,
): Promise<GoalDetailResponse | null> {
	const goal = await stores.goals.get(id);
	if (!goal) return null;
	const contributions = await stores.goals.listContributions([id]);
	return {
		goal: toGoalDto(goal, contributions, clock.today, clock.dayOf(goal.createdAt)),
		contributions: contributions.map(toContributionDto),
	};
}
