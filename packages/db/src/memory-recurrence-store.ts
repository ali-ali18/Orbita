import { randomUUID } from "node:crypto";
import { badReference, DataError, invalid, notFound } from "./errors.ts";
import { assertRefs, byCreated, type MemoryState } from "./memory-state.ts";
import { createMemoryTransactionStore } from "./memory-transaction-store.ts";
import {
	POSTING_DELETED_MESSAGE,
	POSTING_EXISTS_MESSAGE,
	POSTING_KIND_MESSAGE,
	POSTING_MONTH_MESSAGE,
	TRANSACTION_POSTED_MESSAGE,
} from "./messages.ts";
import type { RecurrenceStore } from "./recurrence-store.ts";
import { applyPatch, cleanMonth, normalizeRecurrence } from "./rules.ts";
import { normalizeTransaction } from "./transaction-data.ts";

export function createMemoryRecurrenceStore(state: MemoryState): RecurrenceStore {
	const transactions = createMemoryTransactionStore(state);
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
				remindDayBefore: input.remindDayBefore ?? false,
			});
			assertRefs(state, { accountIds: [data.accountId], cardId: data.cardId, categoryId: data.categoryId });
			const now = state.now();
			const record = {
				id: input.id ?? randomUUID(),
				...data,
				archivedAt: null,
				createdAt: now,
				updatedAt: now,
			};
			state.recurrences.set(record.id, record);
			return { ...record };
		},
		async update(id, patch) {
			const current = need(id);
			const { id: _id, archivedAt: _a, createdAt: _c, updatedAt: _u, ...data } = current;
			const next = normalizeRecurrence(applyPatch(data, patch));
			assertRefs(
				state,
				{ accountIds: [next.accountId], cardId: next.cardId, categoryId: next.categoryId },
				{ accountIds: [data.accountId], cardId: data.cardId, categoryId: data.categoryId },
			);
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
			const recurrence = state.recurrences.get(input.recurrenceId);
			const transaction = state.transactions.get(input.transactionId);
			if (!recurrence || !transaction) throw badReference();
			if (transaction.deletedAt !== null) throw invalid(POSTING_DELETED_MESSAGE);
			if (transaction.kind !== recurrence.kind) throw invalid(POSTING_KIND_MESSAGE);
			if (transaction.budgetMonth !== input.month) throw invalid(POSTING_MONTH_MESSAGE);
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
		async postWithTransaction(input) {
			cleanMonth(input.month);
			const { recurrenceId, month } = input;
			const data = normalizeTransaction(input.transaction);
			const recurrence = state.recurrences.get(recurrenceId);
			if (!recurrence) throw badReference();
			if (data.kind !== recurrence.kind) throw invalid(POSTING_KIND_MESSAGE);
			if (data.budgetMonth !== month) throw invalid(POSTING_MONTH_MESSAGE);
			const taken = () => state.postings.some((p) => p.recurrenceId === recurrenceId && p.month === month);
			if (taken()) throw new DataError("duplicate", POSTING_EXISTS_MESSAGE);
			const transaction = await transactions.create(input.transaction);
			// `create` cede a vez: outro pedido pode ter lançado o mês enquanto isso. Desfaz por inteiro.
			if (taken()) {
				state.transactions.delete(transaction.id);
				throw new DataError("duplicate", POSTING_EXISTS_MESSAGE);
			}
			const posting = { recurrenceId, month, transactionId: transaction.id };
			state.postings.push(posting);
			return { transaction, posting: { ...posting } };
		},
	};
}
