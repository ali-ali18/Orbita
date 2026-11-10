import { describe, expect, it } from "vitest";
import { HOME_TABS, offsetOfPage, pageFromOffset, resolvePage } from "./home-tabs-model.ts";

describe("abas do Início", () => {
	it("Contas vem primeiro e Investimentos depois", () => {
		expect(HOME_TABS.map((t) => t.label)).toEqual(["Contas", "Investimentos"]);
	});

	it("a aba acompanha o arrasto: passou da metade, troca", () => {
		expect(pageFromOffset(0, 390, 2)).toBe(0);
		expect(pageFromOffset(194, 390, 2)).toBe(0);
		expect(pageFromOffset(196, 390, 2)).toBe(1);
		expect(pageFromOffset(390, 390, 2)).toBe(1);
	});

	it("não sai do intervalo (rolagem elástica) nem quebra sem largura", () => {
		expect(pageFromOffset(-40, 390, 2)).toBe(0);
		expect(pageFromOffset(900, 390, 2)).toBe(1);
		expect(pageFromOffset(100, 0, 2)).toBe(0);
	});

	it("tocar na aba rola até o começo da página", () => {
		expect(offsetOfPage(0, 390)).toBe(0);
		expect(offsetOfPage(1, 390)).toBe(390);
	});

	it("animando até a aba tocada, a aba não pisca de volta pela página de origem", () => {
		// Tocou em Investimentos (1) estando em Contas: a rolagem ainda passa por 0 e por 0,5.
		expect(resolvePage(0, 390, 2, 1)).toEqual({ page: 1, target: 1 });
		expect(resolvePage(120, 390, 2, 1)).toEqual({ page: 1, target: 1 });
		// Chegou: libera o destino.
		expect(resolvePage(390, 390, 2, 1)).toEqual({ page: 1, target: null });
		// Sem destino pendente, o arrasto manda.
		expect(resolvePage(100, 390, 2, null)).toEqual({ page: 0, target: null });
	});
});
