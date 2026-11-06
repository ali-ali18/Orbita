import { randomUUID } from "node:crypto";
import { badReference, DataError, notFound } from "./errors.ts";
import { assertRefs, byCreated, type MemoryState } from "./memory-state.ts";
import { POSTING_EXISTS_MESSAGE, TRANSACTION_POSTED_MESSAGE } from "./messages.ts";
import type { RecurrenceStore } from "./recurrence-store.ts";
import { applyPatch, cleanMonth, normalizeRecurrence } from "./rules.ts";

export function createMemoryRecurrenceStore(state: MemoryState): RecurrenceStore {
	const need = (id: string) => {
		const found = state.recurrences.get(id);
		if (!found) throw notFound("Recorrência");
		return found;
	};
	return {
		async create(input) {
			const data = normalizeRecurrence({
				...input,
				endDate: input.endDate ?? null,
				categoryId: input.categoryId ?? null,
				accountId: input.accountId ?? null,
				cardId: input.cardId ?? null,
			});
			assertRefs(state, { accountIds: [data.accountId], cardId: data.cardId, categoryId: data.categoryId });
			const now = state.now();
			const record = { id: randomUUID(), ...data, archivedAt: null, createdAt: now, updatedAt: now };
			state.recurrences.set(record.id, record);
			return { ...record };
		},
		async update(id, patch) {
			const current = need(id);
			const { id: _id, archivedAt: _a, createdAt: _c, updatedAt: _u, ...data } = current;
			const next = normalizeRecurrence(applyPatch(data, patch));
			assertRefs(state, { accountIds: [next.accountId], cardId: next.cardId, categoryId: next.categoryId });
			const record = { ...current, ...next, updatedAt: state.now() };
			state.recurrences.set(id, record);
			return { ...record };
		},
		async archive(id) {
			const current = need(id);
			if (current.archivedAt === null) {
				const now = state.now();
				state.recurrences.set(id, { ...current, archivedAt: now, updatedAt: now });
			}
			return { ...need(id) };
		},
		async list() {
			return [...state.recurrences.values()]
				.filter((r) => r.archivedAt === null)
				.sort(byCreated)
				.map((r) => ({ ...r }));
		},
		async get(id) {
			const found = state.recurrences.get(id);
			return found ? { ...found } : null;
		},
		async listPostings(month) {
			cleanMonth(month);
			return state.postings.filter((p) => p.month === month).map((p) => ({ ...p }));
		},
		async recordPosting(input) {
			cleanMonth(input.month);
			if (!state.recurrences.has(input.recurrenceId) || !state.transactions.has(input.transactionId)) {
				throw badReference();
			}
			if (state.postings.some((p) => p.recurrenceId === input.recurrenceId && p.month === input.month)) {
				throw new DataError("duplicate", POSTING_EXISTS_MESSAGE);
			}
			if (state.postings.some((p) => p.transactionId === input.transactionId)) {
				throw new DataError("duplicate", TRANSACTION_POSTED_MESSAGE);
			}
			const record = {
				recurrenceId: input.recurrenceId,
				month: input.month,
				transactionId: input.transactionId,
			};
			state.postings.push(record);
			return { ...record };
		},
	};
}
