import type { ChatConversationDto } from "@orbita/shared";
import { describe, expect, it } from "vitest";
import {
	agentBadgeFor,
	conversationTitle,
	conversationWhen,
	emptyConversations,
	flattenConversationPages,
	PAGE_SIZE,
	RECENT_COUNT,
	renameError,
	searchTerm,
	showSeeAll,
} from "./conversations-model.ts";

const conv = (id: string, title = id): ChatConversationDto => ({
	id,
	title,
	updatedAt: "2026-11-08T15:00:00.000Z",
	agentId: null,
});

describe("gaveta do chat", () => {
	it("mostra 3 conversas e 'Ver todas' só quando o servidor avisa que há mais", () => {
		expect(RECENT_COUNT).toBe(3);
		expect(PAGE_SIZE).toBeLessThanOrEqual(50);
		expect(showSeeAll("abc")).toBe(true);
		expect(showSeeAll(null)).toBe(false);
		expect(showSeeAll(undefined)).toBe(false);
		expect(showSeeAll("")).toBe(false);
	});
});

describe("páginas da lista", () => {
	it("junta as páginas sem repetir conversa, mantendo a ordem", () => {
		const pages = [
			{ conversations: [conv("a"), conv("b")] },
			{ conversations: [conv("b"), conv("c")] },
			{ conversations: [] },
		];
		expect(flattenConversationPages(pages).map((c) => c.id)).toEqual(["a", "b", "c"]);
		expect(flattenConversationPages([])).toEqual([]);
	});
});

describe("busca", () => {
	it("apara o texto e vazio vira lista completa", () => {
		expect(searchTerm("  mercado ")).toBe("mercado");
		expect(searchTerm("   ")).toBeUndefined();
		expect(searchTerm("")).toBeUndefined();
		expect(searchTerm("a".repeat(150))).toHaveLength(100);
	});

	it("a tela vazia diz se não há conversa ou se a busca não achou", () => {
		expect(emptyConversations(undefined).title).toBe("Nenhuma conversa ainda");
		expect(emptyConversations("viagem").title).toBe("Nada encontrado para “viagem”");
	});
});

describe("data da última mensagem", () => {
	const today = "2026-11-08";
	it("hoje mostra a hora de São Paulo; ontem, 'ontem'; antes, dia e mês", () => {
		expect(conversationWhen("2026-11-08T17:30:00Z", today)).toBe("14:30");
		expect(conversationWhen("2026-11-07T20:00:00Z", today)).toBe("ontem");
		expect(conversationWhen("2026-11-03T12:00:00Z", today)).toBe("3 nov");
		expect(conversationWhen("2026-01-15T12:00:00Z", today)).toBe("15 jan");
	});

	it("vira o dia em São Paulo, não em UTC, e de outro ano mostra o ano", () => {
		// 01:00 UTC de 8/11 ainda é 22:00 de 7/11 em São Paulo.
		expect(conversationWhen("2026-11-08T01:00:00Z", today)).toBe("ontem");
		expect(conversationWhen("2025-12-31T12:00:00Z", today)).toBe("31 dez 2025");
		// Virada de mês: ontem de 1º de dezembro é 30 de novembro.
		expect(conversationWhen("2026-11-30T15:00:00Z", "2026-12-01")).toBe("ontem");
	});

	it("data inválida não quebra a linha", () => {
		expect(conversationWhen("lixo", today)).toBe("");
	});
});

describe("título e selo do agente", () => {
	it("título nunca aparece vazio", () => {
		expect(conversationTitle("  ")).toBe("Conversa");
		expect(conversationTitle(" Viagem ")).toBe("Viagem");
	});

	it("o selo vem do agente da conversa; Órbita e agente sumido ficam sem selo", () => {
		const agents = [
			{ id: "ag1", name: "Vigia", builtinKey: "vigia" as const },
			{ id: "ag2", name: "Meu agente", builtinKey: null },
		];
		expect(agentBadgeFor("ag1", agents)).toEqual({ name: "Vigia", visual: "vigia" });
		expect(agentBadgeFor("ag2", agents)).toEqual({ name: "Meu agente", visual: "custom" });
		expect(agentBadgeFor(null, agents)).toBeNull();
		expect(agentBadgeFor("apagado", agents)).toBeNull();
	});
});

describe("renomear", () => {
	it("segue a regra do servidor: nome não vazio, até 60 letras", () => {
		expect(renameError("Viagem")).toBeNull();
		expect(renameError("   ")).toBe("Dê um nome à conversa.");
		expect(renameError("a".repeat(60))).toBeNull();
		expect(renameError("a".repeat(61))).toBe("O nome tem até 60 letras.");
	});
});
