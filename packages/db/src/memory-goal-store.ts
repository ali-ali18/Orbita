import { randomUUID } from "node:crypto";
import { DataError, invalid, notFound } from "./errors.ts";
import type { GoalRecord, GoalStore } from "./goal-store.ts";
import { assertRefs, byCreated, type MemoryState } from "./memory-state.ts";
import { GOAL_ARCHIVED_MESSAGE, GOAL_TRANSACTION_MESSAGE, ID_EXISTS_MESSAGE } from "./messages.ts";
import { applyPatch, cleanCents, cleanLocalDate, normalizeGoal } from "./rules.ts";

export function createMemoryGoalStore(state: MemoryState): GoalStore {
	const need = (id: string): GoalRecord => {
		const found = state.goals.get(id);
		if (!found) throw notFound("Meta");
		return found;
	};
	const needActive = (id: string): GoalRecord => {
		const found = need(id);
		if (found.archivedAt !== null) throw invalid(GOAL_ARCHIVED_MESSAGE);
		return found;
	};
	return {
		async create(input) {
			const data = normalizeGoal(input);
			if (input.id !== undefined && state.goals.has(input.id))
				throw new DataError("duplicate", ID_EXISTS_MESSAGE);
			const accountId = input.accountId ?? null;
			assertRefs(state, { accountIds: [accountId] });
			const now = state.now();
			const record: GoalRecord = {
				id: input.id ?? randomUUID(),
				...data,
				accountId,
				archivedAt: null,
				createdAt: now,
				updatedAt: now,
			};
			state.goals.set(record.id, record);
			return { ...record };
		},
		async update(id, patch) {
			const current = needActive(id);
			const { name, targetCents, deadline, icon, chartSlot, accountId } = applyPatch(current, patch);
			const data = normalizeGoal({ name, targetCents, deadline, icon, chartSlot });
			assertRefs(state, { accountIds: [accountId] }, { accountIds: [current.accountId] });
			const record = { ...current, ...data, accountId, updatedAt: state.now() };
			state.goals.set(id, record);
			return { ...record };
		},
		async archive(id) {
			const current = need(id);
			if (current.archivedAt === null) {
				const now = state.now();
				state.goals.set(id, { ...current, archivedAt: now, updatedAt: now });
				if (state.preferences.leftoverGoalId === id) {
					state.preferences = { ...state.preferences, leftoverGoalId: null };
				}
			}
			return { ...need(id) };
		},
		async list() {
			return [...state.goals.values()]
				.filter((g) => g.archivedAt === null)
				.sort(byCreated)
				.map((g) => ({ ...g }));
		},
		async get(id) {
			const found = state.goals.get(id);
			return found ? { ...found } : null;
		},
		async addContribution(goalId, input) {
			needActive(goalId);
			const amountCents = cleanCents(input.amountCents, "O valor", 1);
			const date = cleanLocalDate(input.date);
			const transactionId = input.transactionId ?? null;
			if (transactionId !== null) {
				const tx = state.transactions.get(transactionId);
				if (!tx || tx.deletedAt !== null) throw new DataError("bad_reference", GOAL_TRANSACTION_MESSAGE);
			}
			const record = {
				id: randomUUID(),
				goalId,
				amountCents,
				date,
				transactionId,
				createdAt: state.now(),
			};
			state.goalContributions.set(record.id, record);
			return { ...record };
		},
		async removeContribution(goalId, contributionId) {
			const found = state.goalContributions.get(contributionId);
			if (!found || found.goalId !== goalId) throw notFound("Contribuição");
			state.goalContributions.delete(contributionId);
		},
		async listContributions(goalIds) {
			const wanted = new Set(goalIds);
			return [...state.goalContributions.values()]
				.filter((c) => wanted.has(c.goalId))
				.sort(
					(a, b) =>
						b.date.localeCompare(a.date) ||
						b.createdAt.getTime() - a.createdAt.getTime() ||
						b.id.localeCompare(a.id),
				)
				.map((c) => ({ ...c }));
		},
	};
}
