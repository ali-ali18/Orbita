import { randomUUID } from "node:crypto";
import { invalid, notFound } from "./errors.ts";
import type { IncomeSourceRecord, IncomeSourceStore } from "./income-source-store.ts";
import { assertRefs, byCreated, type MemoryState } from "./memory-state.ts";
import { INCOME_ARCHIVED_MESSAGE } from "./messages.ts";
import { applyPatch, normalizeIncomeSource } from "./rules.ts";

export function createMemoryIncomeSourceStore(state: MemoryState): IncomeSourceStore {
	const need = (id: string): IncomeSourceRecord => {
		const found = state.incomeSources.get(id);
		if (!found) throw notFound("Renda");
		return found;
	};
	return {
		async create(input) {
			const data = normalizeIncomeSource(input);
			const accountId = input.accountId ?? null;
			assertRefs(state, { accountIds: [accountId] });
			const now = state.now();
			const record: IncomeSourceRecord = {
				id: randomUUID(),
				...data,
				accountId,
				archivedAt: null,
				createdAt: now,
				updatedAt: now,
			};
			state.incomeSources.set(record.id, record);
			return { ...record };
		},
		async update(id, patch) {
			const current = need(id);
			if (current.archivedAt !== null) throw invalid(INCOME_ARCHIVED_MESSAGE);
			const merged = applyPatch(current, patch);
			const data = normalizeIncomeSource(merged);
			assertRefs(state, { accountIds: [merged.accountId] }, { accountIds: [current.accountId] });
			const record = { ...current, ...data, accountId: merged.accountId, updatedAt: state.now() };
			state.incomeSources.set(id, record);
			return { ...record };
		},
		async archive(id) {
			const current = need(id);
			if (current.archivedAt === null) {
				const now = state.now();
				state.incomeSources.set(id, { ...current, archivedAt: now, updatedAt: now });
			}
			return { ...need(id) };
		},
		async list() {
			return [...state.incomeSources.values()]
				.filter((s) => s.archivedAt === null)
				.sort(byCreated)
				.map((s) => ({ ...s }));
		},
		async get(id) {
			const found = state.incomeSources.get(id);
			return found ? { ...found } : null;
		},
	};
}
