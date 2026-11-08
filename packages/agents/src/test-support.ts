import type {
	BudgetBefore,
	GoalsListResponse,
	MonthSummaryResponse,
	PlanDto,
	RecurrenceDto,
	TransactionDto,
} from "@orbita/shared";
import type { AgentReader, AgentWriter, Catalog, InvoiceData, TransactionQuery } from "./backend.ts";
import type { ModelClient, ModelRequest, ModelResponse, TurnHandlers } from "./model.ts";
import type { ToolContext } from "./tool.ts";

/** Fakes dos testes: nenhum fala com rede nem com banco. */

export const TODAY = "2026-11-15";
export const MONTH = "2026-11";

export const CATALOG: Catalog = {
	categories: [
		{ id: "cat-del", name: "Delivery", slug: "delivery" },
		{ id: "cat-mer", name: "Mercado", slug: "mercado" },
		{ id: "cat-out", name: "Outros", slug: "outros" },
	],
	accounts: [{ id: "acc-1", name: "Conta Inter", kind: "checking" }],
	cards: [{ id: "card-1", name: "Nubank", last4: "1234", closingDay: 10, dueDay: 17 }],
	defaultAccountId: null,
};

export function tx(overrides: Partial<TransactionDto> & { id: string }): TransactionDto {
	return {
		kind: "expense",
		amountCents: 1000,
		date: "2026-11-10",
		description: "Compra",
		categoryId: null,
		accountId: null,
		cardId: "card-1",
		counterpartAccountId: null,
		refundOfId: null,
		budgetMonth: MONTH,
		invoiceMonth: "2026-12",
		installmentGroupId: null,
		installmentNumber: null,
		installmentCount: null,
		status: "confirmed",
		source: "manual",
		externalId: null,
		note: null,
		sourceCategory: null,
		merchantName: null,
		categoryEditedByOwner: false,
		splitGroupId: null,
		createdAt: "2026-11-10T12:00:00.000Z",
		updatedAt: "2026-11-10T12:00:00.000Z",
		...overrides,
	};
}

export function summary(overrides: Partial<MonthSummaryResponse> = {}): MonthSummaryResponse {
	return {
		month: MONTH,
		summary: {
			spentCents: 52067,
			incomeCents: 300000,
			refundCreditCents: 0,
			byCategory: { "cat-del": 20000, "cat-mer": 30000, "cat-out": 2067 },
		},
		budgets: [
			{
				scope: "total",
				limitCents: 100000,
				spentCents: 52067,
				remainingCents: 47933,
				ratio: 0.52067,
				overBudget: false,
				alert: false,
			},
			{
				scope: "cat-del",
				limitCents: 15000,
				spentCents: 20000,
				remainingCents: -5000,
				ratio: 1.3333,
				overBudget: true,
				alert: true,
			},
		],
		budgetAlertPercent: 80,
		safeToSpend: { availableCents: 47933, perDayCents: 2995, remainingDays: 16 },
		projection: { projectedCents: 90000, lowConfidence: false },
		pendingRecurring: { expenseCents: 5000, incomeCents: 0 },
		refundCreditCents: 0,
		...overrides,
	};
}

/** O dono do caso real: renda R$ 2.300, histórico R$ 2.775 reduzido para caber (renda − 10%). */
export function plan(overrides: Partial<PlanDto> = {}): PlanDto {
	return {
		month: MONTH,
		incomeCents: 230000,
		reservePercent: 10,
		feasible: true,
		buckets: { commitmentsCents: 5000, dailyCents: 202000, goalsCents: 0, reserveCents: 23000, leftCents: 0 },
		commitments: [
			{ id: "rec:1", name: "Netflix", categoryId: "cat-out", amountCents: 5000, source: "recurrence" },
		],
		goals: [],
		categories: [
			{ categoryId: "cat-mer", name: "Mercado", commitmentsCents: 0, dailyCents: 111892, totalCents: 111892 },
			{ categoryId: "cat-del", name: "Delivery", commitmentsCents: 0, dailyCents: 90108, totalCents: 90108 },
			{ categoryId: "cat-out", name: "Outros", commitmentsCents: 5000, dailyCents: 0, totalCents: 5000 },
		],
		budget: { totalCents: 207000, byCategory: { "cat-mer": 111892, "cat-del": 90108, "cat-out": 5000 } },
		cut: { wantedCents: 277500, capCents: 207000 },
		monthsUsed: 3,
		warnings: [
			{
				code: "scaled_to_fit",
				message:
					"Seu histórico de gastos é R$ 2.775,00, acima do que cabe na renda; ajustei os limites para caber em R$ 2.070,00.",
				amountCents: 70500,
			},
		],
		replacesCount: 0,
		...overrides,
	};
}

export const PLAN_PREVIOUS: BudgetBefore[] = [
	{ scope: "total", limitCents: 230000 },
	{ scope: "cat-mer", limitCents: null },
];

export interface FakeReaderData {
	transactions: TransactionDto[];
	summaries: Record<string, MonthSummaryResponse>;
	invoice: InvoiceData | null;
	recurrences: RecurrenceDto[];
	goals: GoalsListResponse;
	plan: PlanDto;
	catalog: Catalog;
}

export function fakeReader(data: Partial<FakeReaderData> = {}) {
	const state: FakeReaderData = {
		transactions: [],
		summaries: { [MONTH]: summary() },
		invoice: null,
		recurrences: [],
		goals: { goals: [], totals: { savedCents: 0, targetCents: 0 } },
		plan: plan(),
		catalog: CATALOG,
		...data,
	};
	const queries: TransactionQuery[] = [];
	const planCalls: Array<[string, number | undefined]> = [];
	const reader: AgentReader = {
		async catalog() {
			return state.catalog;
		},
		async monthSummary(month) {
			const found = state.summaries[month];
			if (!found)
				return summary({
					month,
					summary: { spentCents: 0, incomeCents: 0, refundCreditCents: 0, byCategory: {} },
					budgets: [],
					safeToSpend: null,
					projection: null,
				});
			return found;
		},
		async listTransactions(query) {
			queries.push(query);
			const start = query.cursor ? Number(query.cursor) : 0;
			const rows = state.transactions.filter(
				(t) =>
					(!query.from || t.date >= query.from) &&
					(!query.to || t.date <= query.to) &&
					(!query.kinds || query.kinds.includes(t.kind)) &&
					(!query.statuses || query.statuses.includes(t.status)) &&
					(!query.minCents || t.amountCents >= query.minCents) &&
					(!query.maxCents || t.amountCents <= query.maxCents) &&
					(!query.categoryIds || (t.categoryId !== null && query.categoryIds.includes(t.categoryId))),
			);
			const page = rows.slice(start, start + query.limit);
			const next = start + query.limit < rows.length ? String(start + query.limit) : null;
			return { transactions: page, nextCursor: next };
		},
		async getTransaction(id) {
			return state.transactions.find((t) => t.id === id) ?? null;
		},
		async cardInvoice() {
			if (!state.invoice) throw new Error("sem fatura");
			return state.invoice;
		},
		async recurrences() {
			return state.recurrences;
		},
		async goals() {
			return state.goals;
		},
		async incomePlan(month, reservePercent) {
			planCalls.push([month, reservePercent]);
			return { ...state.plan, month };
		},
	};
	return { reader, state, queries, planCalls };
}

export function toolContext(reader: AgentReader, catalog: Catalog = CATALOG): ToolContext {
	return { today: TODAY, currentMonth: MONTH, reader, catalog: async () => catalog };
}

export function fakeWriter() {
	const calls: Array<[string, ...unknown[]]> = [];
	const writer: AgentWriter = {
		async createTransaction(input) {
			calls.push(["createTransaction", input]);
			return { id: "tx-new" };
		},
		async setCategory(id, categoryId) {
			calls.push(["setCategory", id, categoryId]);
			return { previousCategoryId: "cat-out", previousEditedByOwner: false };
		},
		async restoreCategory(id, categoryId, edited) {
			calls.push(["restoreCategory", id, categoryId, edited]);
		},
		async confirmTransaction(id) {
			calls.push(["confirmTransaction", id]);
			return { wasPending: true };
		},
		async revertConfirmation(id) {
			calls.push(["revertConfirmation", id]);
		},
		async deleteTransaction(id) {
			calls.push(["deleteTransaction", id]);
			return true;
		},
		async applyPlan(month, reservePercent) {
			calls.push(["applyPlan", month, reservePercent]);
			return { previous: PLAN_PREVIOUS };
		},
		async restoreBudgets(previous) {
			calls.push(["restoreBudgets", previous]);
		},
	};
	return { writer, calls };
}

type ScriptStep = (
	request: ModelRequest,
) => Pick<ModelResponse, "content" | "stopReason"> &
	Partial<Pick<ModelResponse, "usage" | "model">> & { streamText?: string[] };

/** Cliente falso: devolve as respostas combinadas, em ordem, e guarda cada pedido recebido. */
export function scriptedClient(steps: ScriptStep[]) {
	const requests: ModelRequest[] = [];
	let i = 0;
	const client: ModelClient = {
		async turn(request: ModelRequest, handlers: TurnHandlers) {
			requests.push(structuredClone(request));
			const step = steps[i];
			i += 1;
			if (!step) throw new Error("o cliente falso ficou sem respostas combinadas");
			const out = step(request);
			for (const piece of out.streamText ?? []) handlers.onText(piece);
			return {
				content: out.content,
				stopReason: out.stopReason,
				model: out.model ?? request.model,
				usage: out.usage ?? { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
			};
		},
	};
	return { client, requests };
}

export const toolUse = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input });
export const textBlock = (text: string) => ({ type: "text", text });
