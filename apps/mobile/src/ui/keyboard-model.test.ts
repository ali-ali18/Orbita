import { describe, expect, it } from "vitest";
import { keyboardPadding } from "./keyboard-model.ts";

describe("keyboardPadding", () => {
	it("fechado não reserva nada", () => {
		expect(keyboardPadding(0, 24)).toBe(0);
	});
	it("aberto reserva a altura do teclado menos a área segura de baixo", () => {
		expect(keyboardPadding(300, 24)).toBe(276);
		expect(keyboardPadding(300, 0)).toBe(300);
	});
	it("nunca fica negativo", () => {
		expect(keyboardPadding(10, 24)).toBe(0);
		expect(keyboardPadding(-12, 24)).toBe(0);
	});
});
