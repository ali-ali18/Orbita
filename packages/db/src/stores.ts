import type { AccountStore } from "./account-store.ts";
import type { AiUsageStore } from "./ai-usage-store.ts";
import type { AuthStore } from "./auth-store.ts";
import type { BudgetStore } from "./budget-store.ts";
import type { CardStore } from "./card-store.ts";
import type { CategoryRuleStore } from "./category-rule-store.ts";
import type { CategoryStore } from "./category-store.ts";
import type { ChatStore } from "./chat-store.ts";
import type { Db } from "./client.ts";
import type { GoalStore } from "./goal-store.ts";
import type { IdempotencyStore } from "./idempotency-store.ts";
import type { ImportBatchStore } from "./import-batch-store.ts";
import { createMemoryAccountStore } from "./memory-account-store.ts";
import { createMemoryAiUsageStore } from "./memory-ai-usage-store.ts";
import { createMemoryAuthStore } from "./memory-auth-store.ts";
import { createMemoryBudgetStore } from "./memory-budget-store.ts";
import { createMemoryCardStore } from "./memory-card-store.ts";
import { createMemoryCategoryRuleStore } from "./memory-category-rule-store.ts";
import { createMemoryCategoryStore } from "./memory-category-store.ts";
import { createMemoryChatStore } from "./memory-chat-store.ts";
import { createMemoryGoalStore } from "./memory-goal-store.ts";
import { createMemoryIdempotencyStore } from "./memory-idempotency-store.ts";
import { createMemoryImportBatchStore } from "./memory-import-batch-store.ts";
import { createMemoryPluggyConnectSessionStore } from "./memory-pluggy-connect-session-store.ts";
import { createMemoryPluggyConnectionStore } from "./memory-pluggy-connection-store.ts";
import { createMemoryPreferencesStore } from "./memory-preferences-store.ts";
import { createMemoryRecurrenceStore } from "./memory-recurrence-store.ts";
import { createMemorySecretStore } from "./memory-secret-store.ts";
import { type Clock, createMemoryState } from "./memory-state.ts";
import { createMemoryTransactionStore } from "./memory-transaction-store.ts";
import type { PluggyConnectSessionStore } from "./pluggy-connect-session-store.ts";
import type { PluggyConnectionStore } from "./pluggy-connection-store.ts";
import type { PreferencesStore } from "./preferences-store.ts";
import { createPrismaAccountStore } from "./prisma-account-store.ts";
import { createPrismaAiUsageStore } from "./prisma-ai-usage-store.ts";
import { createPrismaAuthStore } from "./prisma-auth-store.ts";
import { createPrismaBudgetStore } from "./prisma-budget-store.ts";
import { createPrismaCardStore } from "./prisma-card-store.ts";
import { createPrismaCategoryRuleStore } from "./prisma-category-rule-store.ts";
import { createPrismaCategoryStore } from "./prisma-category-store.ts";
import { createPrismaChatStore } from "./prisma-chat-store.ts";
import { createPrismaGoalStore } from "./prisma-goal-store.ts";
import { createPrismaIdempotencyStore } from "./prisma-idempotency-store.ts";
import { createPrismaImportBatchStore } from "./prisma-import-batch-store.ts";
import { createPrismaPluggyConnectSessionStore } from "./prisma-pluggy-connect-session-store.ts";
import { createPrismaPluggyConnectionStore } from "./prisma-pluggy-connection-store.ts";
import { createPrismaPreferencesStore } from "./prisma-preferences-store.ts";
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
	categoryRules: CategoryRuleStore;
	transactions: TransactionStore;
	recurrences: RecurrenceStore;
	budgets: BudgetStore;
	secrets: SecretStore;
	pluggyConnections: PluggyConnectionStore;
	pluggyConnectSessions: PluggyConnectSessionStore;
	idempotency: IdempotencyStore;
	imports: ImportBatchStore;
	preferences: PreferencesStore;
	goals: GoalStore;
	chat: ChatStore;
	aiUsage: AiUsageStore;
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
		categoryRules: createPrismaCategoryRuleStore(db, now),
		transactions: createPrismaTransactionStore(db, now),
		recurrences: createPrismaRecurrenceStore(db, now),
		budgets: createPrismaBudgetStore(db, now),
		secrets: createPrismaSecretStore(db, now),
		pluggyConnections: createPrismaPluggyConnectionStore(db, now),
		pluggyConnectSessions: createPrismaPluggyConnectSessionStore(db),
		idempotency: createPrismaIdempotencyStore(db),
		imports: createPrismaImportBatchStore(db),
		preferences: createPrismaPreferencesStore(db),
		goals: createPrismaGoalStore(db, now),
		chat: createPrismaChatStore(db, now),
		aiUsage: createPrismaAiUsageStore(db),
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
		categoryRules: createMemoryCategoryRuleStore(state),
		transactions: createMemoryTransactionStore(state),
		recurrences: createMemoryRecurrenceStore(state),
		budgets: createMemoryBudgetStore(state),
		secrets: createMemorySecretStore(state),
		pluggyConnections: createMemoryPluggyConnectionStore(state),
		pluggyConnectSessions: createMemoryPluggyConnectSessionStore(),
		idempotency: createMemoryIdempotencyStore(),
		imports: createMemoryImportBatchStore(),
		preferences: createMemoryPreferencesStore(state),
		goals: createMemoryGoalStore(state),
		chat: createMemoryChatStore(state.now),
		aiUsage: createMemoryAiUsageStore(),
	};
}
