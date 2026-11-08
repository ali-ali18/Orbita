import { installmentSchedule, invoiceFor } from "@orbita/core";
import { DataError, type Stores, type TransactionPatch, type TransactionRecord } from "@orbita/db";
import type {
	InstallmentCreateBody,
	TransactionApiCreateBody,
	TransactionApiUpdateBody,
	TransactionSplitBody,
} from "@orbita/shared";
import { defined, orNotFound } from "../../http/errors.ts";

/** Em qual fatura cai a compra: quem decide é o engine, nunca o cliente. */
export async function invoiceMonthFor(stores: Stores, cardId: string, date: string): Promise<string> {
	const config = await stores.cards.getConfig(cardId);
	if (!config) throw new DataError("bad_reference", "O cartão informado não existe.");
	return invoiceFor(date, config).month;
}

const isCardRow = (kind: string, cardId: string | null | undefined) =>
	Boolean(cardId) && kind !== "card_payment";

export async function createTransaction(
	stores: Stores,
	body: TransactionApiCreateBody,
): Promise<TransactionRecord> {
	const input = defined(body);
	const invoiceMonth = isCardRow(body.kind, body.cardId)
		? await invoiceMonthFor(stores, body.cardId as string, body.date)
		: null;
	return stores.transactions.create({ ...input, invoiceMonth });
}

export async function createInstallments(
	stores: Stores,
	body: InstallmentCreateBody,
): Promise<TransactionRecord[]> {
	const card = await stores.cards.getConfig(body.cardId);
	if (!card) throw new DataError("bad_reference", "O cartão informado não existe.");
	const schedule = installmentSchedule({
		purchaseDate: body.date,
		totalCents: body.totalCents,
		count: body.count,
		card,
	});
	return stores.transactions.createInstallmentGroup(
		schedule.map((item) => ({
			kind: "expense" as const,
			amountCents: item.amountCents,
			date: body.date,
			description: body.description,
			categoryId: body.categoryId ?? null,
			cardId: body.cardId,
			invoiceMonth: item.invoiceMonth,
			budgetMonth: item.budgetMonth,
			installmentNumber: item.number,
			installmentCount: item.count,
		})),
	);
}

export async function updateTransaction(
	stores: Stores,
	id: string,
	body: TransactionApiUpdateBody,
): Promise<TransactionRecord> {
	const current = orNotFound(await stores.transactions.get(id), "Lançamento", "o");
	const patch: TransactionPatch = defined(body);
	// Trocar a categoria à mão protege o lançamento de reclassificação por regra.
	if (patch.categoryId !== undefined && patch.categoryId !== current.categoryId) {
		patch.categoryEditedByOwner = true;
	}

	// O calendário de um parcelamento (fatura e mês de cada parcela) nasce junto com o grupo: mexer em
	// uma parcela só deixaria o grupo incoerente. Descrição, categoria e observação continuam livres.
	if (current.installmentGroupId !== null) {
		const changes = (["cardId", "date", "kind", "amountCents"] as const).some(
			(key) => patch[key] !== undefined && patch[key] !== current[key],
		);
		if (changes) {
			throw new DataError(
				"invalid",
				"Para mudar a data, o cartão ou o valor de um parcelamento, apague e lance de novo.",
			);
		}
	}

	// Compra avulsa: a fatura acompanha a data/cartão (parcela nunca chega aqui com mudança).
	if (current.installmentGroupId === null) {
		const kind = patch.kind ?? current.kind;
		const date = patch.date ?? current.date;
		const cardId = patch.cardId === undefined ? current.cardId : patch.cardId;
		if (isCardRow(kind, cardId)) {
			const touched = patch.date !== undefined || patch.cardId !== undefined || patch.kind !== undefined;
			if (touched) patch.invoiceMonth = await invoiceMonthFor(stores, cardId as string, date);
		} else if (current.invoiceMonth !== null) {
			patch.invoiceMonth = null;
		}
	}
	return stores.transactions.update(id, patch);
}

export async function deleteTransaction(
	stores: Stores,
	id: string,
	scope: "item" | "group",
): Promise<number> {
	const current = orNotFound(await stores.transactions.get(id), "Lançamento", "o");
	if (scope === "group") {
		if (current.installmentGroupId === null) {
			throw new DataError("invalid", "Este lançamento não faz parte de um parcelamento.");
		}
		return stores.transactions.softDeleteGroup(current.installmentGroupId);
	}
	return (await stores.transactions.softDelete(id)) ? 1 : 0;
}

/**
 * Divide o lançamento em partes com categorias próprias. Quem confere que a soma fecha exatamente é o engine
 * (`checkSplit`, dentro do store); o servidor só repassa. O original sai e as partes entram numa operação só.
 */
export async function splitTransaction(
	stores: Stores,
	id: string,
	body: TransactionSplitBody,
): Promise<TransactionRecord[]> {
	return stores.transactions.splitTransaction(
		id,
		body.parts.map((part) => ({
			amountCents: part.amountCents,
			categoryId: part.categoryId ?? null,
			description: part.description,
		})),
	);
}

/** Pendente vira confirmado. Já confirmado volta como está (dois toques seguidos não dão erro). */
export async function confirmTransaction(stores: Stores, id: string): Promise<TransactionRecord> {
	const current = orNotFound(await stores.transactions.get(id), "Lançamento", "o");
	return current.status === "confirmed" ? current : stores.transactions.update(id, { status: "confirmed" });
}

export { decodeCursor, encodeCursor, listRecentPage } from "@orbita/ledger";
