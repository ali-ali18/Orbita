import { describe, expect, it } from "vitest";
import { suggestCategory, suggestionState, suggestionText } from "./category-suggestion.ts";

const categories = [
	{ id: "c-del", name: "Delivery", archivedAt: null },
	{ id: "c-mer", name: "Mercado", archivedAt: null },
	{ id: "c-old", name: "Antiga", archivedAt: "2026-01-01T00:00:00.000Z" },
];
const rules = [
	{ pattern: "ifood", categoryId: "c-del" },
	{ pattern: "ifood mercado", categoryId: "c-mer" },
	{ pattern: "padaria", categoryId: "c-old" },
];

describe("suggestCategory", () => {
	it("usa a regra aprendida e devolve o nome como o dono digitou", () => {
		expect(suggestCategory({ kind: "expense", description: "iFood", rules, categories })).toEqual({
			categoryId: "c-del",
			categoryName: "Delivery",
			label: "iFood",
		});
	});

	it("casa pelo nome do estabelecimento, ignorando prefixo de banco, data e acento", () => {
		const s = suggestCategory({
			kind: "expense",
			description: "Pix enviado - IFOOD 12/11",
			rules,
			categories,
		});
		expect(s?.categoryId).toBe("c-del");
	});

	it("a regra mais específica vence", () => {
		const s = suggestCategory({ kind: "expense", description: "iFood Mercado", rules, categories });
		expect(s?.categoryId).toBe("c-mer");
	});

	it("não sugere sem regra, com descrição vazia, em entrada ou para categoria arquivada", () => {
		expect(suggestCategory({ kind: "expense", description: "Cinema", rules, categories })).toBeNull();
		expect(suggestCategory({ kind: "expense", description: "  ", rules, categories })).toBeNull();
		expect(suggestCategory({ kind: "income", description: "iFood", rules, categories })).toBeNull();
		expect(suggestCategory({ kind: "expense", description: "Padaria", rules, categories })).toBeNull();
		expect(suggestCategory({ kind: "expense", description: "iFood", rules: [], categories })).toBeNull();
	});

	it("palavra inteira: 'suberbo' não casa com a regra 'uber'", () => {
		const r = [{ pattern: "uber", categoryId: "c-del" }];
		expect(suggestCategory({ kind: "expense", description: "Suberbo", rules: r, categories })).toBeNull();
		expect(
			suggestCategory({ kind: "expense", description: "Uber trip", rules: r, categories }),
		).not.toBeNull();
	});

	it("limpa texto de controle e limita o rótulo", () => {
		const s = suggestCategory({
			kind: "expense",
			description: `iFood ${"x".repeat(80)}`,
			rules: [{ pattern: "ifood", categoryId: "c-del" }],
			categories,
		});
		expect(s?.label.length).toBeLessThanOrEqual(40);
	});
});

describe("suggestionText", () => {
	it("monta a frase do Figma", () => {
		expect(suggestionText({ categoryName: "Delivery", label: "iFood" })).toBe(
			"Sugeri Delivery porque iFood costuma ser delivery",
		);
	});
});

describe("suggestionState", () => {
	const suggestion = { categoryId: "c-del", categoryName: "Delivery", label: "iFood" };
	it("sem escolha do dono, a sugestão aparece e já vale", () => {
		expect(suggestionState({ suggestion, chosenId: null, dismissedId: null })).toEqual({
			shown: suggestion,
			effectiveId: "c-del",
		});
	});
	it("a escolha do dono vale sobre a sugestão e esconde a frase", () => {
		expect(suggestionState({ suggestion, chosenId: "c-mer", dismissedId: null })).toEqual({
			shown: null,
			effectiveId: "c-mer",
		});
	});
	it("dispensada, não vale mais; outra sugestão volta a aparecer", () => {
		expect(suggestionState({ suggestion, chosenId: null, dismissedId: "c-del" })).toEqual({
			shown: null,
			effectiveId: null,
		});
		expect(
			suggestionState({
				suggestion: { ...suggestion, categoryId: "c-mer" },
				chosenId: null,
				dismissedId: "c-del",
			}).shown?.categoryId,
		).toBe("c-mer");
	});
	it("sem sugestão, vale o que o dono escolheu", () => {
		expect(suggestionState({ suggestion: null, chosenId: "c-mer", dismissedId: null })).toEqual({
			shown: null,
			effectiveId: "c-mer",
		});
		expect(suggestionState({ suggestion: null, chosenId: null, dismissedId: null }).effectiveId).toBeNull();
	});
});
