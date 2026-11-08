import { describe, expect, it } from "vitest";
import { dragOffset, SHEET_DISMISS_DISTANCE, shouldDismiss } from "./sheet-model.ts";

describe("gesto da gaveta", () => {
	it("não deixa o painel subir acima do repouso", () => {
		expect(dragOffset(-40)).toBe(0);
		expect(dragOffset(30)).toBe(30);
	});

	it("fecha ao passar da distância mínima", () => {
		expect(shouldDismiss(SHEET_DISMISS_DISTANCE, 0)).toBe(true);
		expect(shouldDismiss(SHEET_DISMISS_DISTANCE - 1, 0.1)).toBe(false);
	});

	it("fecha num gesto rápido para baixo, mesmo curto", () => {
		expect(shouldDismiss(20, 1.2)).toBe(true);
	});

	it("não fecha com gesto rápido para cima", () => {
		expect(shouldDismiss(-20, 2)).toBe(false);
		expect(shouldDismiss(0, 2)).toBe(false);
	});
});
