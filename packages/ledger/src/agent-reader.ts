import type { AgentReader } from "@orbita/agents";
import { toLocalDate } from "@orbita/core";
import type { Stores } from "@orbita/db";
import { toCardDto, toRecurrenceDto, toTransactionDto } from "./dto.ts";
import { listGoals } from "./goals.ts";
import { buildIncomePlan } from "./income-plan.ts";
import { invoiceOwedCents } from "./invoices-overview.ts";
import { loadSetupAnalysis } from "./setup.ts";
import { cardInvoice, monthSummary } from "./summary.ts";
import { listRecentPage } from "./transaction-list.ts";

/**
 * As portas dos agentes (`@orbita/agents`) em cima dos serviços que o resto da API já usa. A IA lê exatamente o que
 * as telas leem (mesmo `monthSummary`, mesma fatura do engine) e escreve pelos mesmos serviços do "+".
 */
export function createAgentReader(stores: Stores, now: () => Date): AgentReader {
	const today = () => toLocalDate(now());
	return {
		async catalog() {
			const [categories, accounts, cards, preferences] = await Promise.all([
				stores.categories.list(),
				stores.accounts.list(),
				stores.cards.list(),
				stores.preferences.get(),
			]);
			const activeAccounts = accounts.filter((a) => a.archivedAt === null);
			return {
				categories: categories
					.filter((c) => c.archivedAt === null)
					.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
				accounts: activeAccounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
				cards: cards
					.filter((c) => c.archivedAt === null)
					.map((c) => ({
						id: c.id,
						name: c.name,
						last4: c.last4,
						closingDay: c.closingDay,
						dueDay: c.dueDay,
					})),
				defaultAccountId: activeAccounts.some((a) => a.id === preferences.defaultAccountId)
					? preferences.defaultAccountId
					: null,
			};
		},
		monthSummary: (month) => monthSummary(stores, month, today()),
		async listTransactions(query) {
			const { cursor, ...filter } = query;
			const page = await listRecentPage(stores, { ...filter, cursor });
			return { transactions: page.transactions.map(toTransactionDto), nextCursor: page.nextCursor };
		},
		async getTransaction(id) {
			const found = await stores.transactions.get(id);
			return found ? toTransactionDto(found) : null;
		},
		async cardInvoice(cardId, month) {
			const result = await cardInvoice(stores, cardId, month, today());
			const card = toCardDto(result.card);
			return {
				card: { id: card.id, name: card.name },
				month: result.invoice.month,
				closingDate: result.invoice.closingDate,
				dueDate: result.invoice.dueDate,
				status: result.invoice.status,
				paymentStatus: result.invoice.paymentStatus,
				paidCents: result.invoice.paidCents,
				owedCents: invoiceOwedCents(
					result.invoice.status,
					result.composition.totalCents,
					result.invoice.paidCents,
				),
				composition: result.composition,
				transactions: result.transactions.map(toTransactionDto),
			};
		},
		async recurrences() {
			return (await stores.recurrences.list()).map(toRecurrenceDto);
		},
		goals: () => listGoals(stores, { today: today(), dayOf: (d) => toLocalDate(d) }),
		incomePlan: (month, reservePercent) => buildIncomePlan(stores, month, today(), reservePercent),
		setupAnalysis: () => loadSetupAnalysis(stores, today()),
	};
}
