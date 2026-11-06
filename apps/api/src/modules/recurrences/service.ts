import { monthOf, occurrencesInMonth } from "@orbita/core";
import {
	DataError,
	type RecurrencePostingRecord,
	type Stores,
	type TransactionRecord,
	toMonthlyRecurrence,
} from "@orbita/db";
import type { RecurrencePostBody } from "@orbita/shared";
import { orNotFound } from "../../http/errors.ts";
import { invoiceMonthFor } from "../transactions/service.ts";

/**
 * Cria o lançamento do mês da recorrência e registra o posting numa operação atômica do store
 * (ou entram os dois ou nenhum; dois pedidos ao mesmo tempo dão um 409).
 */
export async function postRecurrence(
	stores: Stores,
	id: string,
	body: RecurrencePostBody,
): Promise<{ transaction: TransactionRecord; posting: RecurrencePostingRecord }> {
	const recurrence = orNotFound(await stores.recurrences.get(id), "Recorrência");
	if (recurrence.archivedAt) throw new DataError("invalid", "A recorrência está arquivada.");

	const { month } = body;
	// Mesmo com `date` explícita, a recorrência precisa cair neste mês (início e fim valem).
	const [occurrence] = occurrencesInMonth(toMonthlyRecurrence(recurrence), month);
	if (!occurrence)
		throw new DataError("invalid", "A recorrência não cai neste mês (veja o início e o fim dela).");
	const date = body.date ?? occurrence;
	if (monthOf(date) !== month)
		throw new DataError("invalid", "A data precisa estar dentro do mês informado.");

	return stores.recurrences.postWithTransaction({
		recurrenceId: id,
		month,
		transaction: {
			kind: recurrence.kind,
			amountCents: body.amountCents ?? recurrence.amountCents,
			date,
			description: recurrence.name,
			categoryId: recurrence.categoryId,
			accountId: recurrence.accountId,
			cardId: recurrence.cardId,
			invoiceMonth: recurrence.cardId ? await invoiceMonthFor(stores, recurrence.cardId, date) : null,
		},
	});
}
