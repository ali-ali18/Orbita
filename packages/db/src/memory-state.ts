import type { AccountRecord } from "./account-store.ts";
import type { BudgetRecord } from "./budget-store.ts";
import type { CardRecord } from "./card-store.ts";
import type { CategoryRecord } from "./category-store.ts";
import { badReference } from "./errors.ts";
import type { RecurrencePostingRecord, RecurrenceRecord } from "./recurrence-store.ts";
import type { TransactionRecord } from "./transaction-store.ts";

export type Clock = () => Date;

export type StoredTransaction = TransactionRecord & { deletedAt: Date | null };

/** Tabelas em memória; os stores de um mesmo `createMemoryStores()` compartilham, como num banco. */
export interface MemoryState {
	now: Clock;
	accounts: Map<string, AccountRecord>;
	cards: Map<string, CardRecord>;
	categories: Map<string, CategoryRecord & { createdAt: Date }>;
	transactions: Map<string, StoredTransaction>;
	recurrences: Map<string, RecurrenceRecord>;
	postings: RecurrencePostingRecord[];
	budgets: Map<string, BudgetRecord & { createdAt: Date }>;
}

export function createMemoryState(now: Clock = () => new Date()): MemoryState {
	return {
		now,
		accounts: new Map(),
		cards: new Map(),
		categories: new Map(),
		transactions: new Map(),
		recurrences: new Map(),
		postings: [],
		budgets: new Map(),
	};
}

/** O equivalente das chaves estrangeiras do banco. */
export function assertRefs(
	state: MemoryState,
	refs: { accountIds?: (string | null)[]; cardId?: string | null; categoryId?: string | null },
): void {
	for (const id of refs.accountIds ?? []) if (id && !state.accounts.has(id)) throw badReference();
	if (refs.cardId && !state.cards.has(refs.cardId)) throw badReference();
	if (refs.categoryId && !state.categories.has(refs.categoryId)) throw badReference();
}

export const byCreated = <T extends { createdAt: Date; id?: string }>(a: T, b: T) =>
	a.createdAt.getTime() - b.createdAt.getTime() || (a.id ?? "").localeCompare(b.id ?? "");
