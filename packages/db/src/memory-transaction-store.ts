import { randomUUID } from "node:crypto";
import { DataError, invalid, notFound } from "./errors.ts";
import { assertRefs, type MemoryState, type StoredTransaction } from "./memory-state.ts";
import { HAS_REFUNDS_MESSAGE, SPLIT_HAS_REFUNDS_MESSAGE } from "./messages.ts";
import { cleanMonth } from "./rules.ts";
import {
	adoptExternalData,
	byDateAsc,
	byRecent,
	changedColumns,
	checkRecentOptions,
	checkTarget,
	cleanFilter,
	cleanIds,
	cleanLimit,
	DEFAULT_PENDING_LIMIT,
	DUPLICATE_INSTALLMENT_MESSAGE,
	dataOf,
	duplicateExternal,
	matchesFilter,
	mergeTransaction,
	normalizeExternalInstallment,
	normalizeInstallmentGroup,
	normalizeSplit,
	normalizeTransaction,
	refundTargetError,
} from "./transaction-data.ts";
import type {
	InstallmentGroupRecord,
	TransactionData,
	TransactionRecord,
	TransactionStore,
} from "./transaction-store.ts";

export function createMemoryTransactionStore(state: MemoryState): TransactionStore {
	const view = ({ deletedAt: _deleted, ...record }: StoredTransaction): TransactionRecord => ({ ...record });
	const live = () => [...state.transactions.values()].filter((t) => t.deletedAt === null);
	const findExternal = (data: TransactionData) =>
		data.externalId === null
			? undefined
			: [...state.transactions.values()].find(
					(t) => t.source === data.source && t.externalId === data.externalId,
				);

	/** Mesmas checagens que o banco faz sozinho (FK) e que o store faz antes de gravar (estorno). */
	function checkReferences(data: TransactionData, previous?: TransactionData): void {
		if (data.refundOfId !== null) {
			const target = state.transactions.get(data.refundOfId);
			if (!target || target.deletedAt !== null || target.kind !== "expense") throw refundTargetError();
		}
		assertRefs(
			state,
			{
				accountIds: [data.accountId, data.counterpartAccountId],
				cardId: data.cardId,
				categoryId: data.categoryId,
			},
			previous && {
				accountIds: [previous.accountId, previous.counterpartAccountId],
				cardId: previous.cardId,
				categoryId: previous.categoryId,
			},
		);
	}

	/** Apaga os lançamentos, os estornos vivos deles e as ligações com recorrências. */
	function deleteCascade(rootIds: string[]): void {
		const all = new Set(rootIds);
		for (const t of live()) if (t.refundOfId !== null && all.has(t.refundOfId)) all.add(t.id);
		state.postings = state.postings.filter((p) => !all.has(p.transactionId));
		const now = state.now();
		for (const id of all) {
			const t = state.transactions.get(id);
			if (t && t.deletedAt === null) state.transactions.set(id, { ...t, deletedAt: now, updatedAt: now });
		}
	}

	function insert(data: TransactionData): StoredTransaction {
		const now = state.now();
		const row: StoredTransaction = {
			id: randomUUID(),
			...data,
			createdAt: now,
			updatedAt: now,
			deletedAt: null,
		};
		state.transactions.set(row.id, row);
		return row;
	}

	return {
		async create(input) {
			const data = normalizeTransaction(input);
			checkReferences(data);
			if (findExternal(data)) throw duplicateExternal();
			return view(insert(data));
		},

		async createInstallmentGroup(inputs) {
			const rows = normalizeInstallmentGroup(inputs);
			for (const data of rows) {
				checkReferences(data);
				if (findExternal(data)) throw duplicateExternal();
			}
			// Só grava depois de validar todas: ou entram todas ou nenhuma.
			return rows.map((data) => view(insert(data)));
		},

		async upsertByExternal(source, externalId, input) {
			const data = normalizeTransaction({ ...input, source, externalId });
			const existing = findExternal(data);
			if (existing)
				return { created: false, transaction: existing.deletedAt === null ? view(existing) : null };
			checkReferences(data);
			return { created: true, transaction: view(insert(data)) };
		},

		async upsertInstallmentByExternal(source, externalId, input, installment) {
			const data = normalizeExternalInstallment({ ...input, source, externalId }, installment);
			const existing = findExternal(data);
			if (existing)
				return { created: false, transaction: existing.deletedAt === null ? view(existing) : null };
			checkReferences(data);
			// Mesma unicidade do banco: (grupo, número), contando também as apagadas.
			if (
				[...state.transactions.values()].some(
					(t) => t.installmentGroupId === installment.groupId && t.installmentNumber === installment.number,
				)
			)
				throw new DataError("duplicate", DUPLICATE_INSTALLMENT_MESSAGE);
			return { created: true, transaction: view(insert(data)) };
		},

		async adoptExternal(id, source, externalId, patch) {
			const current = state.transactions.get(id);
			if (!current || current.deletedAt !== null || current.source === source) return null;
			const data = adoptExternalData(dataOf(current), source, externalId, patch);
			if (findExternal(data)) return null;
			checkReferences(data, dataOf(current));
			const next: StoredTransaction = { ...current, ...data, updatedAt: state.now() };
			state.transactions.set(id, next);
			return view(next);
		},

		async existsByExternal(source, externalId) {
			return [...state.transactions.values()].some((t) => t.source === source && t.externalId === externalId);
		},

		async findByExternal(source, externalId) {
			const found = [...state.transactions.values()].find(
				(t) => t.source === source && t.externalId === externalId,
			);
			return found && found.deletedAt === null ? view(found) : null;
		},

		async update(id, patch) {
			const current = state.transactions.get(id);
			if (!current || current.deletedAt !== null) throw notFound("Lançamento", "o");
			const before = dataOf(current);
			const data = mergeTransaction(before, patch);
			if (before.kind === "expense" && data.kind !== "expense" && live().some((t) => t.refundOfId === id)) {
				throw invalid(HAS_REFUNDS_MESSAGE);
			}
			checkReferences(data, before);
			if (Object.keys(changedColumns(before, data)).length === 0) return view(current);
			const next: StoredTransaction = { ...current, ...data, updatedAt: state.now() };
			state.transactions.set(id, next);
			return view(next);
		},

		async splitTransaction(id, parts) {
			const current = state.transactions.get(id);
			if (!current || current.deletedAt !== null) throw notFound("Lançamento", "o");
			const rows = normalizeSplit(dataOf(current), parts);
			if (live().some((t) => t.refundOfId === id)) throw invalid(SPLIT_HAS_REFUNDS_MESSAGE);
			for (const data of rows) checkReferences(data);
			// Só grava depois de validar todas: ou entram todas (e o original sai) ou nada muda.
			deleteCascade([id]);
			return rows.map((data) => view(insert(data)));
		},

		async softDelete(id) {
			const current = state.transactions.get(id);
			if (!current || current.deletedAt !== null) return false;
			deleteCascade([id]);
			return true;
		},

		async softDeleteGroup(groupId) {
			const ids = live()
				.filter((t) => t.installmentGroupId === groupId)
				.map((t) => t.id);
			if (ids.length > 0) deleteCascade(ids);
			return ids.length;
		},

		async hardDeleteBySource(source) {
			if (source === "manual") throw invalid("Só dá para apagar lançamentos de uma origem de fora.");
			const doomed = new Set<string>();
			for (const t of state.transactions.values()) if (t.source === source) doomed.add(t.id);
			// Estorno de qualquer origem que aponta para um lançamento apagado também sai.
			for (const t of state.transactions.values()) {
				if (t.refundOfId !== null && doomed.has(t.refundOfId)) doomed.add(t.id);
			}
			state.postings = state.postings.filter((p) => !doomed.has(p.transactionId));
			for (const id of doomed) state.transactions.delete(id);
			return doomed.size;
		},

		async get(id) {
			const found = state.transactions.get(id);
			return found && found.deletedAt === null ? view(found) : null;
		},

		async listByBudgetMonth(month) {
			cleanMonth(month, "O mês do orçamento");
			return live()
				.filter((t) => t.budgetMonth === month)
				.map(view)
				.sort(byDateAsc);
		},

		async listBudgetMonths() {
			return [...new Set(live().map((t) => t.budgetMonth))].sort().reverse();
		},

		async listByInvoice(cardId, invoiceMonth) {
			cleanMonth(invoiceMonth, "O mês da fatura");
			return live()
				.filter((t) => t.cardId === cardId && t.invoiceMonth === invoiceMonth)
				.map(view)
				.sort(byDateAsc);
		},

		async listCardPayments(cardId, { from, to }) {
			return live()
				.filter((t) => t.kind === "card_payment" && t.cardId === cardId && t.date >= from && t.date <= to)
				.map(view)
				.sort(byDateAsc);
		},

		async listByTarget(target, { from, to }) {
			const { accountId, cardId } = checkTarget(target);
			return live()
				.filter(
					(t) =>
						t.date >= from &&
						t.date <= to &&
						(accountId !== undefined ? t.accountId === accountId : t.cardId === cardId),
				)
				.map(view)
				.sort(byDateAsc);
		},

		async listPending(options = {}) {
			const limit = cleanLimit(options.limit ?? DEFAULT_PENDING_LIMIT);
			return live()
				.filter((t) => t.status === "pending")
				.map(view)
				.sort(byRecent)
				.slice(0, limit);
		},

		async getMany(ids) {
			const wanted = new Set(cleanIds(ids));
			return live()
				.filter((t) => wanted.has(t.id))
				.map(view)
				.sort(byDateAsc);
		},

		async listCategoryNotEditedByOwner() {
			return live()
				.filter((t) => !t.categoryEditedByOwner)
				.map(view)
				.sort(byDateAsc);
		},

		async listRecent(options) {
			checkRecentOptions(options);
			const { before, filter } = options;
			return live()
				.map(view)
				.filter((t) => !filter || matchesFilter(t, filter))
				.filter((t) => !before || t.date < before.date || (t.date === before.date && t.id < before.id))
				.sort(byRecent)
				.slice(0, options.limit);
		},

		async countMatching(filter) {
			if (filter) cleanFilter(filter);
			return live()
				.map(view)
				.filter((t) => !filter || matchesFilter(t, filter)).length;
		},

		async listInstallmentGroups(activeFromMonth) {
			cleanMonth(activeFromMonth, "O mês");
			const rows = live()
				.filter((t) => t.installmentGroupId !== null)
				.map(view);
			const groups = new Map<string, TransactionRecord[]>();
			for (const t of rows) {
				const list = groups.get(t.installmentGroupId as string) ?? [];
				list.push(t);
				groups.set(t.installmentGroupId as string, list);
			}
			const result: InstallmentGroupRecord[] = [];
			for (const [groupId, installments] of groups) {
				if (!installments.some((t) => (t.invoiceMonth ?? t.budgetMonth) >= activeFromMonth)) continue;
				result.push({ groupId, installments: installments.sort(byInstallment) });
			}
			return result.sort(byGroup);
		},
	};
}

export const byInstallment = (a: TransactionRecord, b: TransactionRecord) =>
	(a.installmentNumber ?? 0) - (b.installmentNumber ?? 0) || a.id.localeCompare(b.id);

/** Grupos pelo id do grupo (igual nas duas implementações), parcelas por número. */
export const byGroup = (a: InstallmentGroupRecord, b: InstallmentGroupRecord) =>
	a.groupId < b.groupId ? -1 : a.groupId > b.groupId ? 1 : 0;
