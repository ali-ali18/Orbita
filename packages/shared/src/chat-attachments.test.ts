import { describe, expect, it } from "vitest";
import {
	ATTACHMENT_MAX_BYTES,
	ATTACHMENT_SIZE_MESSAGE,
	ATTACHMENT_TYPE_MESSAGE,
	base64ByteLength,
	chatRequestBody,
} from "./chat-api.ts";

const b64 = (bytes: number) => Buffer.alloc(bytes, 1).toString("base64");

describe("anexos do chat", () => {
	it("conta os bytes do base64 sem decodificar", () => {
		for (const n of [1, 2, 3, 10, 1000, 4097]) expect(base64ByteLength(b64(n))).toBe(n);
	});

	it("aceita foto e PDF, com ou sem texto", () => {
		const ok = chatRequestBody.safeParse({
			message: "o que é isto?",
			attachments: [{ mediaType: "image/jpeg", data: b64(100) }],
		});
		expect(ok.success).toBe(true);
		const onlyFile = chatRequestBody.safeParse({
			attachments: [{ mediaType: "application/pdf", data: b64(10) }],
		});
		expect(onlyFile.success).toBe(true);
	});

	it("recusa tipo fora da lista, com mensagem em pt-BR", () => {
		const r = chatRequestBody.safeParse({
			message: "x",
			attachments: [{ mediaType: "image/gif", data: b64(10) }],
		});
		expect(r.success).toBe(false);
		expect(r.error?.issues[0]?.message).toBe(ATTACHMENT_TYPE_MESSAGE);
	});

	it("recusa anexo acima de 5 MB e aceita o limite exato", () => {
		const big = chatRequestBody.safeParse({
			message: "x",
			attachments: [{ mediaType: "image/png", data: b64(ATTACHMENT_MAX_BYTES + 1) }],
		});
		expect(big.success).toBe(false);
		expect(big.error?.issues[0]?.message).toBe(ATTACHMENT_SIZE_MESSAGE);
		const edge = chatRequestBody.safeParse({
			message: "x",
			attachments: [{ mediaType: "image/png", data: b64(ATTACHMENT_MAX_BYTES) }],
		});
		expect(edge.success).toBe(true);
	});

	it("recusa base64 inválido, anexo vazio, mais de 3 anexos e anexo na tarefa fixa", () => {
		const one = { mediaType: "image/png", data: b64(10) };
		const bad = chatRequestBody.safeParse({ message: "x", attachments: [{ ...one, data: "não é base64!" }] });
		expect(bad.success).toBe(false);
		const empty = chatRequestBody.safeParse({ message: "x", attachments: [{ ...one, data: "" }] });
		expect(empty.success).toBe(false);
		expect(chatRequestBody.safeParse({ message: "x", attachments: [one, one, one, one] }).success).toBe(
			false,
		);
		expect(chatRequestBody.safeParse({ intent: "setup", attachments: [one] }).success).toBe(false);
		expect(chatRequestBody.safeParse({ attachments: [] }).success).toBe(false);
	});
});
