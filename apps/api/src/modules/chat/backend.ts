import type { AgentReader, AgentWriter } from "@orbita/agents";
import { monthOf, toLocalDate } from "@orbita/core";
import { DataError, type Stores } from "@orbita/db";
import { orNotFound } from "../../http/errors.ts";
import { toCardDto } from "../cards/dto.ts";
import { toRecurrenceDto } from "../recurrences/dto.ts";
import { cardInvoice, monthSummary } from "../summary/service.ts";
import { toTransactionDto } from "../transactions/dto.ts";
import {
	confirmTransaction,
	createTransaction,
	deleteTransaction,
	listRecentPage,
	updateTransaction,
} from "../transactions/service.ts";

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
				composition: result.composition,
				transactions: result.transactions.map(toTransactionDto),
			};
		},
		async recurrences() {
			return (await stores.recurrences.list()).map(toRecurrenceDto);
		},
	};
}

export function createAgentWriter(stores: Stores): AgentWriter {
	return {
		async createTransaction(input) {
			const created = await createTransaction(stores, input);
			return { id: created.id };
		},
		async setCategory(id, categoryId) {
			const current = orNotFound(await stores.transactions.get(id), "Lançamento", "o");
			await updateTransaction(stores, id, { categoryId });
			return { previousCategoryId: current.categoryId, previousEditedByOwner: current.categoryEditedByOwner };
		},
		async restoreCategory(id, categoryId, editedByOwner) {
			// Se o dono apagou o lançamento depois, não há o que restaurar.
			if (!(await stores.transactions.get(id))) return;
			await stores.transactions.update(id, { categoryId, categoryEditedByOwner: editedByOwner });
		},
		async confirmTransaction(id) {
			const current = orNotFound(await stores.transactions.get(id), "Lançamento", "o");
			await confirmTransaction(stores, id);
			return { wasPending: current.status === "pending" };
		},
		async revertConfirmation(id) {
			if (!(await stores.transactions.get(id))) return;
			await stores.transactions.update(id, { status: "pending" });
		},
		async deleteTransaction(id) {
			try {
				return (await deleteTransaction(stores, id, "item")) > 0;
			} catch (error) {
				// Já apagado pelo dono: o Desfazer repetido não falha.
				if (error instanceof DataError && error.code === "not_found") return false;
				throw error;
			}
		},
	};
}

/** Mês de hoje no fuso de São Paulo. */
export const currentMonthOf = (now: () => Date) => monthOf(toLocalDate(now()));
