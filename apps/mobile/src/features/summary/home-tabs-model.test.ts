import { describe, expect, it } from "vitest";
import {
	HOME_TABS,
	headerFadeStops,
	offsetOfPage,
	pageFromOffset,
	resolvePage,
	tabsFade,
	tabsTouchable,
} from "./home-tabs-model.ts";

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

	it("as abas somem linearmente com a rolagem e voltam ao subir", () => {
		expect(tabsFade(0, 56)).toBe(1);
		expect(tabsFade(14, 56)).toBeCloseTo(0.75, 5);
		expect(tabsFade(28, 56)).toBe(0.5);
		expect(tabsFade(56, 56)).toBe(0);
		expect(tabsFade(400, 56)).toBe(0);
	});

	it("rolagem elástica do topo (negativa) mantém opacidade 1; altura zero some", () => {
		expect(tabsFade(-30, 56)).toBe(1);
		expect(tabsFade(10, 0)).toBe(0);
	});

	it("quase invisível não recebe toque", () => {
		expect(tabsTouchable(1)).toBe(true);
		expect(tabsTouchable(0.1)).toBe(true);
		expect(tabsTouchable(0.09)).toBe(false);
		expect(tabsTouchable(0)).toBe(false);
	});

	it("degradê do header: opaco na barra de status, ~0,72 no avatar, ~0,5 nas abas e 0 na base", () => {
		const stops = headerFadeStops(56, 64, 56);
		const total = 176;
		expect(stops.map((s) => s.opacity)).toEqual([1, 1, 0.72, 0.5, 0]);
		expect(stops[1]?.offset).toBeCloseTo(56 / total, 5);
		expect(stops[2]?.offset).toBeCloseTo(88 / total, 5);
		expect(stops[3]?.offset).toBeCloseTo(148 / total, 5);
		expect(stops[4]?.offset).toBe(1);
		// Offsets crescentes (o SVG exige ordem).
		for (let i = 1; i < stops.length; i++)
			expect(stops[i]?.offset).toBeGreaterThanOrEqual(stops[i - 1]?.offset ?? 0);
		expect(headerFadeStops(0, 0, 0)).toEqual([]);
	});
});
