import { describe, expect, it } from "vitest";
import { ATTACH_SUGGESTION, chatAgentView, ORBITA_VIEW } from "./chat-agent-model.ts";

const agents = [
	{ id: "a-orbita", name: "Órbita", builtinKey: "orbita" },
	{ id: "a-vigia", name: "Vigia", builtinKey: "vigia" },
	{ id: "a-economia", name: "Economia", builtinKey: "economia" },
	{ id: "a-meu", name: "Meu radar", builtinKey: null },
] as const;

describe("chatAgentView", () => {
	it("sem agente é a Órbita, com as sugestões dela", () => {
		expect(chatAgentView(null, agents)).toBe(ORBITA_VIEW);
		expect(chatAgentView(null, undefined).suggestions).toContain(ATTACH_SUGGESTION);
	});

	it("o agente da casa mostra o nome, o rosto e as sugestões próprias, sem a de anexo", () => {
		const view = chatAgentView("a-vigia", agents);
		expect(view).toMatchObject({ id: "a-vigia", name: "Vigia", visual: "vigia" });
		expect(view.suggestions.length).toBeGreaterThanOrEqual(2);
		expect(view.suggestions).not.toContain(ATTACH_SUGGESTION);
		expect(view.suggestions).not.toEqual(ORBITA_VIEW.suggestions);
	});

	it("a Economia tem intro e sugestões próprias, sem a de anexo", () => {
		const view = chatAgentView("a-economia", agents);
		expect(view).toMatchObject({ id: "a-economia", name: "Economia", visual: "economia" });
		expect(view.intro).not.toBe("");
		expect(view.suggestions).toHaveLength(3);
		expect(view.suggestions).not.toContain(ATTACH_SUGGESTION);
	});

	it("o agente do dono usa o nome dele e o rosto genérico", () => {
		expect(chatAgentView("a-meu", agents)).toMatchObject({ name: "Meu radar", visual: "custom" });
	});

	it("o agente da Órbita no cadastro é a Órbita", () => {
		expect(chatAgentView("a-orbita", agents)).toMatchObject({ name: "Órbita", visual: "orbita" });
	});

	it("agente ainda não carregado nunca vira a Órbita", () => {
		const view = chatAgentView("a-vigia", undefined);
		expect(view.name).not.toBe("Órbita");
		expect(view.visual).toBe("custom");
		expect(chatAgentView("apagado", agents).name).toBe("Agente");
	});
});
