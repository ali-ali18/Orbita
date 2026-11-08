import { type ChatConversationCursor, DataError } from "@orbita/db";
import { idSchema } from "@orbita/shared";

/** O cursor é opaco para o app: `milissegundos|id` do último item da página, em base64url. */
export function encodeConversationCursor(c: ChatConversationCursor): string {
	return Buffer.from(`${c.updatedAt.getTime()}|${c.id}`).toString("base64url");
}

export function decodeConversationCursor(raw: string): ChatConversationCursor {
	const [ms, id, ...extra] = Buffer.from(raw, "base64url").toString("utf8").split("|");
	const time = Number(ms);
	if (
		extra.length > 0 ||
		!/^\d{1,15}$/.test(ms ?? "") ||
		!Number.isSafeInteger(time) ||
		!idSchema.safeParse(id).success
	) {
		throw new DataError("invalid", "O cursor da lista é inválido.");
	}
	return { updatedAt: new Date(time), id: id as string };
}
