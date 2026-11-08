import {
	DataError,
	type Stores,
	type TransactionCursor,
	type TransactionFilter,
	type TransactionRecord,
} from "@orbita/db";
import { idSchema, isLocalDate } from "@orbita/shared";

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
	options: { limit: number; cursor?: string | undefined } & TransactionFilter,
): Promise<{ transactions: TransactionRecord[]; nextCursor: string | null }> {
	const { limit, cursor, ...filter } = options;
	const before = cursor === undefined ? undefined : decodeCursor(cursor);
	// Pede um a mais só para saber se há outra página.
	const rows = await stores.transactions.listRecent({
		limit: limit + 1,
		...(before ? { before } : {}),
		filter,
	});
	const transactions = rows.slice(0, limit);
	const last = transactions.at(-1);
	const nextCursor = rows.length > limit && last ? encodeCursor({ date: last.date, id: last.id }) : null;
	return { transactions, nextCursor };
}
