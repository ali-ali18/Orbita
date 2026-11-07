import type { AccountStore } from "./account-store.ts";
import type { AuthStore } from "./auth-store.ts";
import type { BudgetStore } from "./budget-store.ts";
import type { CardStore } from "./card-store.ts";
import type { CategoryStore } from "./category-store.ts";
import type { Db } from "./client.ts";
import { createMemoryAccountStore } from "./memory-account-store.ts";
import { createMemoryAuthStore } from "./memory-auth-store.ts";
import { createMemoryBudgetStore } from "./memory-budget-store.ts";
import { createMemoryCardStore } from "./memory-card-store.ts";
import { createMemoryCategoryStore } from "./memory-category-store.ts";
import { createMemoryPluggyConnectSessionStore } from "./memory-pluggy-connect-session-store.ts";
import { createMemoryPluggyConnectionStore } from "./memory-pluggy-connection-store.ts";
import { createMemoryRecurrenceStore } from "./memory-recurrence-store.ts";
import { createMemorySecretStore } from "./memory-secret-store.ts";
import { type Clock, createMemoryState } from "./memory-state.ts";
import { createMemoryTransactionStore } from "./memory-transaction-store.ts";
import type { PluggyConnectSessionStore } from "./pluggy-connect-session-store.ts";
import type { PluggyConnectionStore } from "./pluggy-connection-store.ts";
import { createPrismaAccountStore } from "./prisma-account-store.ts";
import { createPrismaAuthStore } from "./prisma-auth-store.ts";
import { createPrismaBudgetStore } from "./prisma-budget-store.ts";
import { createPrismaCardStore } from "./prisma-card-store.ts";
import { createPrismaCategoryStore } from "./prisma-category-store.ts";
import { createPrismaPluggyConnectSessionStore } from "./prisma-pluggy-connect-session-store.ts";
import { createPrismaPluggyConnectionStore } from "./prisma-pluggy-connection-store.ts";
import { createPrismaRecurrenceStore } from "./prisma-recurrence-store.ts";
import { createPrismaSecretStore } from "./prisma-secret-store.ts";
import { createPrismaTransactionStore } from "./prisma-transaction-store.ts";
import type { RecurrenceStore } from "./recurrence-store.ts";
import type { SecretStore } from "./secret-store.ts";
import type { TransactionStore } from "./transaction-store.ts";

export interface Stores {
	auth: AuthStore;
	accounts: AccountStore;
	cards: CardStore;
	categories: CategoryStore;
	transactions: TransactionStore;
	recurrences: RecurrenceStore;
	budgets: BudgetStore;
	secrets: SecretStore;
	pluggyConnections: PluggyConnectionStore;
	pluggyConnectSessions: PluggyConnectSessionStore;
}

export interface StoresOptions {
	/** Relógio dos carimbos (`createdAt`, `archivedAt`…). Padrão: `new Date()`. */
	now?: Clock;
}

/** Tudo ligado ao Postgres, numa linha: `const stores = createPrismaStores(createDb(url))`. */
export function createPrismaStores(db: Db, options: StoresOptions = {}): Stores {
	const now = options.now ?? (() => new Date());
	return {
		auth: createPrismaAuthStore(db),
		accounts: createPrismaAccountStore(db, now),
		cards: createPrismaCardStore(db, now),
		categories: createPrismaCategoryStore(db, now),
		transactions: createPrismaTransactionStore(db, now),
		recurrences: createPrismaRecurrenceStore(db, now),
		budgets: createPrismaBudgetStore(db, now),
		secrets: createPrismaSecretStore(db, now),
		pluggyConnections: createPrismaPluggyConnectionStore(db, now),
		pluggyConnectSessions: createPrismaPluggyConnectSessionStore(db),
	};
}

/** Os mesmos stores em memória (testes): compartilham as tabelas, como num banco. */
export function createMemoryStores(options: StoresOptions = {}): Stores {
	const state = createMemoryState(options.now);
	return {
		auth: createMemoryAuthStore(),
		accounts: createMemoryAccountStore(state),
		cards: createMemoryCardStore(state),
		categories: createMemoryCategoryStore(state),
		transactions: createMemoryTransactionStore(state),
		recurrences: createMemoryRecurrenceStore(state),
		budgets: createMemoryBudgetStore(state),
		secrets: createMemorySecretStore(state),
		pluggyConnections: createMemoryPluggyConnectionStore(state),
		pluggyConnectSessions: createMemoryPluggyConnectSessionStore(),
	};
}
