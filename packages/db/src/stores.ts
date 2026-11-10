import type { AccountStore } from "./account-store.ts";
import type { AgentActivityStore } from "./agent-activity-store.ts";
import type { AgentStore } from "./agent-store.ts";
import type { AiUsageStore } from "./ai-usage-store.ts";
import type { AuthStore } from "./auth-store.ts";
import type { BillStore } from "./bill-store.ts";
import type { BudgetStore } from "./budget-store.ts";
import type { CardStore } from "./card-store.ts";
import type { CategoryRuleStore } from "./category-rule-store.ts";
import type { CategoryStore } from "./category-store.ts";
import type { ChatStore } from "./chat-store.ts";
import type { Db } from "./client.ts";
import type { GoalStore } from "./goal-store.ts";
import type { HomeLayoutStore } from "./home-layout-store.ts";
import type { IdempotencyStore } from "./idempotency-store.ts";
import type { ImportBatchStore } from "./import-batch-store.ts";
import type { IncomeSourceStore } from "./income-source-store.ts";
import type { InvestmentStore } from "./investment-store.ts";
import { createMemoryAccountStore } from "./memory-account-store.ts";
import { createMemoryAgentActivityStore } from "./memory-agent-activity-store.ts";
import { createMemoryAgentStore } from "./memory-agent-store.ts";
import { createMemoryAiUsageStore } from "./memory-ai-usage-store.ts";
import { createMemoryAuthStore } from "./memory-auth-store.ts";
import { createMemoryBillStore } from "./memory-bill-store.ts";
import { createMemoryBudgetStore } from "./memory-budget-store.ts";
import { createMemoryCardStore } from "./memory-card-store.ts";
import { createMemoryCategoryRuleStore } from "./memory-category-rule-store.ts";
import { createMemoryCategoryStore } from "./memory-category-store.ts";
import { createMemoryChatStore } from "./memory-chat-store.ts";
import { createMemoryGoalStore } from "./memory-goal-store.ts";
import { createMemoryHomeLayoutStore } from "./memory-home-layout-store.ts";
import { createMemoryIdempotencyStore } from "./memory-idempotency-store.ts";
import { createMemoryImportBatchStore } from "./memory-import-batch-store.ts";
import { createMemoryIncomeSourceStore } from "./memory-income-source-store.ts";
import { createMemoryInvestmentStore } from "./memory-investment-store.ts";
import { createMemoryNotificationInboxStore } from "./memory-notification-inbox-store.ts";
import { createMemoryPluggyConnectSessionStore } from "./memory-pluggy-connect-session-store.ts";
import { createMemoryPluggyConnectionStore } from "./memory-pluggy-connection-store.ts";
import { createMemoryPreferencesStore } from "./memory-preferences-store.ts";
import { createMemoryRecurrenceStore } from "./memory-recurrence-store.ts";
import { createMemorySecretStore } from "./memory-secret-store.ts";
import { type Clock, createMemoryState } from "./memory-state.ts";
import { createMemoryTransactionStore } from "./memory-transaction-store.ts";
import type { NotificationInboxStore } from "./notification-inbox-store.ts";
import type { PluggyConnectSessionStore } from "./pluggy-connect-session-store.ts";
import type { PluggyConnectionStore } from "./pluggy-connection-store.ts";
import type { PreferencesStore } from "./preferences-store.ts";
import { createPrismaAccountStore } from "./prisma-account-store.ts";
import { createPrismaAgentActivityStore } from "./prisma-agent-activity-store.ts";
import { createPrismaAgentStore } from "./prisma-agent-store.ts";
import { createPrismaAiUsageStore } from "./prisma-ai-usage-store.ts";
import { createPrismaAuthStore } from "./prisma-auth-store.ts";
import { createPrismaBillStore } from "./prisma-bill-store.ts";
import { createPrismaBudgetStore } from "./prisma-budget-store.ts";
import { createPrismaCardStore } from "./prisma-card-store.ts";
import { createPrismaCategoryRuleStore } from "./prisma-category-rule-store.ts";
import { createPrismaCategoryStore } from "./prisma-category-store.ts";
import { createPrismaChatStore } from "./prisma-chat-store.ts";
import { createPrismaGoalStore } from "./prisma-goal-store.ts";
import { createPrismaHomeLayoutStore } from "./prisma-home-layout-store.ts";
import { createPrismaIdempotencyStore } from "./prisma-idempotency-store.ts";
import { createPrismaImportBatchStore } from "./prisma-import-batch-store.ts";
import { createPrismaIncomeSourceStore } from "./prisma-income-source-store.ts";
import { createPrismaInvestmentStore } from "./prisma-investment-store.ts";
import { createPrismaNotificationInboxStore } from "./prisma-notification-inbox-store.ts";
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
	bills: BillStore;
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
	notificationInbox: NotificationInboxStore;
	homeLayout: HomeLayoutStore;
	goals: GoalStore;
	incomeSources: IncomeSourceStore;
	investments: InvestmentStore;
	chat: ChatStore;
	aiUsage: AiUsageStore;
	agents: AgentStore;
	agentActivity: AgentActivityStore;
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
		bills: createPrismaBillStore(db),
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
		notificationInbox: createPrismaNotificationInboxStore(db, now),
		homeLayout: createPrismaHomeLayoutStore(db),
		goals: createPrismaGoalStore(db, now),
		incomeSources: createPrismaIncomeSourceStore(db, now),
		investments: createPrismaInvestmentStore(db, now),
		chat: createPrismaChatStore(db, now),
		aiUsage: createPrismaAiUsageStore(db),
		agents: createPrismaAgentStore(db, now),
		agentActivity: createPrismaAgentActivityStore(db, now),
	};
}

/** Os mesmos stores em memória (testes): compartilham as tabelas, como num banco. */
export function createMemoryStores(options: StoresOptions = {}): Stores {
	const state = createMemoryState(options.now);
	return {
		auth: createMemoryAuthStore(),
		accounts: createMemoryAccountStore(state),
		cards: createMemoryCardStore(state),
		bills: createMemoryBillStore(state),
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
		notificationInbox: createMemoryNotificationInboxStore(state.now),
		homeLayout: createMemoryHomeLayoutStore(),
		goals: createMemoryGoalStore(state),
		incomeSources: createMemoryIncomeSourceStore(state),
		investments: createMemoryInvestmentStore(state),
		chat: createMemoryChatStore(state.now, (id) => state.agents.has(id)),
		aiUsage: createMemoryAiUsageStore(),
		agents: createMemoryAgentStore(state),
		agentActivity: createMemoryAgentActivityStore(state),
	};
}
