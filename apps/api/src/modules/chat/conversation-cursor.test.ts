import { describe, expect, it } from "vitest";
import { decodeConversationCursor, encodeConversationCursor } from "./conversation-cursor.ts";

describe("cursor da lista de conversas", () => {
	it("ida e volta mantém o instante e o id", () => {
		const cursor = { updatedAt: new Date("2026-11-08T15:00:00.123Z"), id: "abc123" };
		const raw = encodeConversationCursor(cursor);
		expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(decodeConversationCursor(raw)).toEqual(cursor);
	});

	it("recusa lixo com erro de dados inválidos", () => {
		const bad = (text: string) => Buffer.from(text).toString("base64url");
		for (const raw of ["###", bad("sem-barra"), bad("abc|id"), bad("1|2|3"), bad("-5|id"), bad("1|")]) {
			expect(() => decodeConversationCursor(raw)).toThrowError(expect.objectContaining({ code: "invalid" }));
		}
	});
});
