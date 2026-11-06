import { monthOf, occurrencesInMonth } from "@orbita/core";
import { DataError, type RecurrencePostingRecord, type Stores, type TransactionRecord, toMonthlyRecurrence } from "@orbita/db";
import type { RecurrencePostBody } from "@orbita/shared";
import { orNotFound } from "../../http/errors.ts";
import { invoiceMonthFor } from "../transactions/service.ts";

/**
 * Cria o lançamento do mês para a recorrência e registra o posting. Não existe transação
 * de banco entre os dois passos (são stores separados), então: confere antes (resposta
 * amigável) e, se o posting falhar mesmo assim (pedido concorrente), apaga o lançamento
 * recém-criado para não deixar um gasto duplicado sem ligação.
 */
export async function postRecurrence(
	stores: Stores,
	id: string,
	body: RecurrencePostBody,
): Promise<{ transaction: TransactionRecord; posting: RecurrencePostingRecord }> {
	const recurrence = orNotFound(await stores.recurrences.get(id), "Recorrência");
	if (recurrence.archivedAt) throw new DataError("invalid", "A recorrência está arquivada.");

	const { month } = body;
	const postings = await stores.recurrences.listPostings(month);
	if (postings.some((p) => p.recurrenceId === id)) {
		throw new DataError("duplicate", "Esta recorrência já foi lançada neste mês.");
	}

	const date = body.date ?? occurrencesInMonth(toMonthlyRecurrence(recurrence), month)[0];
	if (!date) throw new DataError("invalid", "A recorrência não cai neste mês (veja o início e o fim dela).");
	if (monthOf(date) !== month) throw new DataError("invalid", "A data precisa estar dentro do mês informado.");

	const transaction = await stores.transactions.create({
		kind: recurrence.kind,
		amountCents: body.amountCents ?? recurrence.amountCents,
		date,
		description: recurrence.name,
		categoryId: recurrence.categoryId,
		accountId: recurrence.accountId,
		cardId: recurrence.cardId,
		invoiceMonth: recurrence.cardId ? await invoiceMonthFor(stores, recurrence.cardId, date) : null,
	});
	try {
		const posting = await stores.recurrences.recordPosting({
			recurrenceId: id,
			month,
			transactionId: transaction.id,
		});
		return { transaction, posting };
	} catch (e) {
		await stores.transactions.softDelete(transaction.id).catch(() => false);
		throw e;
	}
}
