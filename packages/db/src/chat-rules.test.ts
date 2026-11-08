import { describe, expect, it } from "vitest";
import { cleanRenamedTitle, deriveChatTitle } from "./chat-rules.ts";
import { CHAT_TITLE_MAX } from "./chat-store.ts";

const AT = new Date("2026-11-08T15:00:00Z");

describe("deriveChatTitle", () => {
	it("mantém mensagem curta, só colapsando espaços", () => {
		expect(deriveChatTitle("  quanto   gastei\n com delivery?  ", AT)).toBe("quanto gastei com delivery?");
		const exact = "a".repeat(CHAT_TITLE_MAX);
		expect(deriveChatTitle(exact, AT)).toBe(exact);
	});

	it("corta numa fronteira de palavra e acrescenta reticências, dentro do limite", () => {
		const title = deriveChatTitle("Quanto eu gastei com delivery e mercado nos últimos três meses?", AT);
		expect(title).toBe("Quanto eu gastei com delivery e mercado…");
		expect([...title].length).toBeLessThanOrEqual(CHAT_TITLE_MAX);
		expect(title.endsWith("…")).toBe(true);
	});

	it("não deixa pontuação solta antes das reticências", () => {
		expect(deriveChatTitle("Me mostra os gastos do mês de outubro, por categoria, por favor", AT)).toBe(
			"Me mostra os gastos do mês de outubro…",
		);
	});

	it("palavra que termina exatamente no limite fica inteira", () => {
		const text = `${"a".repeat(CHAT_TITLE_MAX - 1)} resto da frase`;
		expect(deriveChatTitle(text, AT)).toBe(`${"a".repeat(CHAT_TITLE_MAX - 1)}…`);
	});

	it("sem espaço útil, corte seco no limite", () => {
		const title = deriveChatTitle("x".repeat(200), AT);
		expect([...title]).toHaveLength(CHAT_TITLE_MAX);
		expect(title).toBe(`${"x".repeat(CHAT_TITLE_MAX - 1)}…`);
		// Um espaço logo no começo não pode reduzir o título a quase nada.
		const early = deriveChatTitle(`oi ${"y".repeat(100)}`, AT);
		expect([...early]).toHaveLength(CHAT_TITLE_MAX);
	});

	it("não parte emoji ao cortar", () => {
		const title = deriveChatTitle("😀".repeat(80), AT);
		expect([...title]).toHaveLength(CHAT_TITLE_MAX);
		expect(title.slice(0, -1)).toBe("😀".repeat(CHAT_TITLE_MAX - 1));
	});

	it("nunca devolve título vazio: cai em 'Conversa de 8 nov' (dia em São Paulo)", () => {
		expect(deriveChatTitle("", AT)).toBe("Conversa de 8 nov");
		expect(deriveChatTitle(" \n\t ", AT)).toBe("Conversa de 8 nov");
		// 02:00 UTC de 9/11 ainda é 8/11 à noite em São Paulo (UTC−3).
		expect(deriveChatTitle("", new Date("2026-11-09T02:00:00Z"))).toBe("Conversa de 8 nov");
		expect(deriveChatTitle("", new Date("2026-01-03T12:00:00Z"))).toBe("Conversa de 3 jan");
	});
});

describe("cleanRenamedTitle", () => {
	it("aceita nome com espaços colapsados e recusa vazio e nome grande demais", () => {
		expect(cleanRenamedTitle("  Viagem   de   dezembro ")).toBe("Viagem de dezembro");
		expect(() => cleanRenamedTitle("   ")).toThrow(/nome/i);
		expect(() => cleanRenamedTitle("a".repeat(61))).toThrow(/60/);
		expect(cleanRenamedTitle("a".repeat(60))).toHaveLength(60);
	});
});
