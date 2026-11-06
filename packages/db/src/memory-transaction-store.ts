import { randomUUID } from "node:crypto";
import { notFound } from "./errors.ts";
import { assertRefs, type MemoryState, type StoredTransaction } from "./memory-state.ts";
import { cleanMonth } from "./rules.ts";
import {
	byDateAsc,
	byRecent,
	checkRecentOptions,
	dataOf,
	duplicateExternal,
	mergeTransaction,
	normalizeInstallmentGroup,
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
	function checkReferences(data: TransactionData): void {
		if (data.refundOfId !== null) {
			const target = state.transactions.get(data.refundOfId);
			if (!target || target.deletedAt !== null || target.kind !== "expense") throw refundTargetError();
		}
		assertRefs(state, {
			accountIds: [data.accountId, data.counterpartAccountId],
			cardId: data.cardId,
			categoryId: data.categoryId,
		});
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

		async update(id, patch) {
			const current = state.transactions.get(id);
			if (!current || current.deletedAt !== null) throw notFound("Lançamento", "o");
			const data = mergeTransaction(dataOf(current), patch);
			checkReferences(data);
			const next: StoredTransaction = { ...current, ...data, updatedAt: state.now() };
			state.transactions.set(id, next);
			return view(next);
		},

		async softDelete(id) {
			const current = state.transactions.get(id);
			if (!current || current.deletedAt !== null) return false;
			const now = state.now();
			state.transactions.set(id, { ...current, deletedAt: now, updatedAt: now });
			return true;
		},

		async softDeleteGroup(groupId) {
			const now = state.now();
			let count = 0;
			for (const t of live()) {
				if (t.installmentGroupId !== groupId) continue;
				state.transactions.set(t.id, { ...t, deletedAt: now, updatedAt: now });
				count++;
			}
			return count;
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

		async listByInvoice(cardId, invoiceMonth) {
			cleanMonth(invoiceMonth, "O mês da fatura");
			return live()
				.filter((t) => t.cardId === cardId && t.invoiceMonth === invoiceMonth)
				.map(view)
				.sort(byDateAsc);
		},

		async listPending() {
			return live()
				.filter((t) => t.status === "pending")
				.map(view)
				.sort(byRecent);
		},

		async listRecent(options) {
			checkRecentOptions(options);
			const { before } = options;
			return live()
				.map(view)
				.filter((t) => !before || t.date < before.date || (t.date === before.date && t.id < before.id))
				.sort(byRecent)
				.slice(0, options.limit);
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

/** Grupos pela data da primeira parcela, depois pelo id do grupo. */
export const byGroup = (a: InstallmentGroupRecord, b: InstallmentGroupRecord) =>
	(a.installments[0]?.date ?? "").localeCompare(b.installments[0]?.date ?? "") ||
	a.groupId.localeCompare(b.groupId);
