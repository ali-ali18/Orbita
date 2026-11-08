import { describe, expect, it } from "vitest";
import { looksLikeOwnerName } from "./mapping.ts";

describe("looksLikeOwnerName: nome do titular tolerante", () => {
	const owner = "Alisson Alves Bapka";
	it.each([
		"Pix enviado - Alisson Alves Bapka",
		"PIX ENVIADO   ALISSON   ALVES   BAPKA",
		"PIX RECEBIDO Alisson Alves Ba…",
		"TED Alisson Alves Bapka",
		"TRANSF ENVIADA PIX Alisson Alves…",
		"Pix recebido ALISSON AL...",
		"Transferência enviada pelo Pix - alisson alves bap",
	])("%s é o titular", (text) => {
		expect(looksLikeOwnerName(text, owner)).toBe(true);
	});

	it.each([
		"Pix enviado - Rei Dos Coins",
		"PIX ENVIADO ASSOCIACAO P…",
		"Pix enviado - Alisson Souza",
		"Pix enviado - Alisson",
		"Pix enviado - Alisson Alves",
		"Pix enviado - Alisson Alves Bapka Junior",
		"",
	])("'%s' não é o titular", (text) => {
		expect(looksLikeOwnerName(text, owner)).toBe(false);
	});

	it("sem sobrenome no nome do titular, nada prova nada", () => {
		expect(looksLikeOwnerName("Pix enviado - Alisson", "Alisson")).toBe(false);
	});
});
