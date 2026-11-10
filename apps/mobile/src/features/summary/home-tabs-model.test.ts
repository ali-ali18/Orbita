import { describe, expect, it } from "vitest";
import { HOME_TABS, offsetOfPage, pageFromOffset } from "./home-tabs-model.ts";

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
});
