import type { AccountRecord } from "./account-store.ts";
import type { BudgetRecord } from "./budget-store.ts";
import type { CardRecord } from "./card-store.ts";
import type { CategoryRecord } from "./category-store.ts";
import { badReference } from "./errors.ts";
import type { RecurrencePostingRecord, RecurrenceRecord } from "./recurrence-store.ts";
import { archivedAccount, archivedCard, archivedCategory, type Refs } from "./references.ts";
import type { StoredSecret } from "./secret-store.ts";
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
	secrets: Map<string, StoredSecret & { createdAt: Date }>;
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
		secrets: new Map(),
	};
}

/**
 * O equivalente das chaves estrangeiras do banco, mais a regra de arquivados: apontar para
 * conta, cartão ou categoria arquivada só vale se a referência não mudou (`previous`).
 */
export function assertRefs(state: MemoryState, refs: Refs, previous: Refs = {}): void {
	(refs.accountIds ?? []).forEach((id, i) => {
		if (!id) return;
		const account = state.accounts.get(id);
		if (!account) throw badReference();
		if (account.archivedAt !== null && previous.accountIds?.[i] !== id) throw archivedAccount();
	});
	if (refs.cardId) {
		const card = state.cards.get(refs.cardId);
		if (!card) throw badReference();
		if (card.archivedAt !== null && previous.cardId !== refs.cardId) throw archivedCard();
	}
	if (refs.categoryId) {
		const category = state.categories.get(refs.categoryId);
		if (!category) throw badReference();
		if (category.archivedAt !== null && previous.categoryId !== refs.categoryId) throw archivedCategory();
	}
}

export const byCreated = <T extends { createdAt: Date; id?: string }>(a: T, b: T) =>
	a.createdAt.getTime() - b.createdAt.getTime() || (a.id ?? "").localeCompare(b.id ?? "");
