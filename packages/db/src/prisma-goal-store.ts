import type { GoalIcon } from "@orbita/shared";
import type { Db } from "./client.ts";
import { DataError, invalid, notFound } from "./errors.ts";
import type { GoalContributionRecord, GoalRecord, GoalStore } from "./goal-store.ts";
import { fromDbDate, toDbDate } from "./local-date.ts";
import type { Clock } from "./memory-state.ts";
import { GOAL_ARCHIVED_MESSAGE, GOAL_TRANSACTION_MESSAGE, ID_EXISTS_MESSAGE } from "./messages.ts";
import { translate } from "./prisma-errors.ts";
import { checkReferences } from "./prisma-references.ts";
import { applyPatch, cleanCents, cleanLocalDate, normalizeGoal } from "./rules.ts";

type GoalRow = Omit<GoalRecord, "deadline" | "icon"> & { deadline: Date | null; icon: string };
type ContributionRow = Omit<GoalContributionRecord, "date"> & { date: Date };

const toRecord = (row: GoalRow): GoalRecord => ({
	id: row.id,
	name: row.name,
	targetCents: row.targetCents,
	deadline: row.deadline ? fromDbDate(row.deadline) : null,
	accountId: row.accountId,
	icon: row.icon as GoalIcon,
	chartSlot: row.chartSlot,
	archivedAt: row.archivedAt,
	createdAt: row.createdAt,
	updatedAt: row.updatedAt,
});

const toContribution = (row: ContributionRow): GoalContributionRecord => ({
	id: row.id,
	goalId: row.goalId,
	amountCents: row.amountCents,
	date: fromDbDate(row.date),
	transactionId: row.transactionId,
	createdAt: row.createdAt,
});

export function createPrismaGoalStore(db: Db, now: Clock): GoalStore {
	const need = async (id: string): Promise<GoalRow> => {
		const found = await db.goal.findUnique({ where: { id } });
		if (!found) throw notFound("Meta");
		return found;
	};
	const needActive = async (id: string): Promise<GoalRow> => {
		const found = await need(id);
		if (found.archivedAt !== null) throw invalid(GOAL_ARCHIVED_MESSAGE);
		return found;
	};
	return {
		async create(input) {
			const data = normalizeGoal(input);
			const accountId = input.accountId ?? null;
			await checkReferences(db, { accountIds: [accountId] });
			const at = now();
			try {
				const row = await db.goal.create({
					data: {
						...data,
						...(input.id ? { id: input.id } : {}),
						deadline: data.deadline === null ? null : toDbDate(data.deadline),
						accountId,
						createdAt: at,
						updatedAt: at,
					},
				});
				return toRecord(row);
			} catch (e) {
				throw translate(e, () => new DataError("duplicate", ID_EXISTS_MESSAGE));
			}
		},
		async update(id, patch) {
			const current = toRecord(await needActive(id));
			const { name, targetCents, deadline, icon, chartSlot, accountId } = applyPatch(current, patch);
			const data = normalizeGoal({ name, targetCents, deadline, icon, chartSlot });
			await checkReferences(db, { accountIds: [accountId] }, { accountIds: [current.accountId] });
			const row = await db.goal.update({
				where: { id },
				data: {
					...data,
					deadline: data.deadline === null ? null : toDbDate(data.deadline),
					accountId,
					updatedAt: now(),
				},
			});
			return toRecord(row);
		},
		async archive(id) {
			const current = await need(id);
			if (current.archivedAt !== null) return toRecord(current);
			const at = now();
			const [row] = await db.$transaction([
				db.goal.update({ where: { id }, data: { archivedAt: at, updatedAt: at } }),
				db.appPreferences.updateMany({ where: { leftoverGoalId: id }, data: { leftoverGoalId: null } }),
			]);
			return toRecord(row);
		},
		async list() {
			const rows = await db.goal.findMany({
				where: { archivedAt: null },
				orderBy: [{ createdAt: "asc" }, { id: "asc" }],
			});
			return rows.map(toRecord);
		},
		async get(id) {
			const row = await db.goal.findUnique({ where: { id } });
			return row ? toRecord(row) : null;
		},
		async addContribution(goalId, input) {
			await needActive(goalId);
			const amountCents = cleanCents(input.amountCents, "O valor", 1);
			const date = cleanLocalDate(input.date);
			const transactionId = input.transactionId ?? null;
			if (transactionId !== null) {
				const tx = await db.transaction.findFirst({
					where: { id: transactionId, deletedAt: null },
					select: { id: true },
				});
				if (!tx) throw new DataError("bad_reference", GOAL_TRANSACTION_MESSAGE);
			}
			const row = await db.goalContribution.create({
				data: { goalId, amountCents, date: toDbDate(date), transactionId, createdAt: now() },
			});
			return toContribution(row);
		},
		async removeContribution(goalId, contributionId) {
			const res = await db.goalContribution.deleteMany({ where: { id: contributionId, goalId } });
			if (res.count === 0) throw notFound("Contribuição");
		},
		async listContributions(goalIds) {
			const rows = await db.goalContribution.findMany({
				where: { goalId: { in: [...goalIds] } },
				orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
			});
			return rows.map(toContribution);
		},
	};
}
