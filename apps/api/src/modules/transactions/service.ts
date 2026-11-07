import { installmentSchedule, invoiceFor } from "@orbita/core";
import {
	DataError,
	type Stores,
	type TransactionCursor,
	type TransactionPatch,
	type TransactionRecord,
} from "@orbita/db";
import {
	type InstallmentCreateBody,
	idSchema,
	isLocalDate,
	type TransactionApiCreateBody,
	type TransactionApiUpdateBody,
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

/** Pendente vira confirmado. Já confirmado volta como está (dois toques seguidos não dão erro). */
export async function confirmTransaction(stores: Stores, id: string): Promise<TransactionRecord> {
	const current = orNotFound(await stores.transactions.get(id), "Lançamento", "o");
	return current.status === "confirmed" ? current : stores.transactions.update(id, { status: "confirmed" });
}

// ---------------------------------------------------------------- cursor

/** O cursor é opaco para o app: `data|id` do último item, em base64url. */
export function encodeCursor(c: TransactionCursor): string {
	return Buffer.from(`${c.date}|${c.id}`).toString("base64url");
}

export function decodeCursor(raw: string): TransactionCursor {
	const [date, id, ...extra] = Buffer.from(raw, "base64url").toString("utf8").split("|");
	if (extra.length > 0 || !isLocalDate(date) || !idSchema.safeParse(id).success) {
		throw new DataError("invalid", "O cursor da lista é inválido.");
	}
	return { date: date as string, id: id as string };
}

export async function listRecentPage(
	stores: Stores,
	options: { limit: number; cursor?: string | undefined },
): Promise<{ transactions: TransactionRecord[]; nextCursor: string | null }> {
	const before = options.cursor === undefined ? undefined : decodeCursor(options.cursor);
	// Pede um a mais só para saber se há outra página.
	const rows = await stores.transactions.listRecent({
		limit: options.limit + 1,
		...(before ? { before } : {}),
	});
	const transactions = rows.slice(0, options.limit);
	const last = transactions.at(-1);
	const nextCursor =
		rows.length > options.limit && last ? encodeCursor({ date: last.date, id: last.id }) : null;
	return { transactions, nextCursor };
}
