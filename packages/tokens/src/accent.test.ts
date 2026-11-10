import { describe, expect, it } from "vitest";
import {
	accentThemeKeys,
	accentThemes,
	colors,
	contrastRatio,
	defaultAccentTheme,
	isAccentThemeKey,
} from "./index.ts";

describe("accentThemes", () => {
	it("tem as sete opções, nesta ordem, e o padrão é o atual (branco)", () => {
		expect(accentThemeKeys).toEqual(["atual", "volt", "amarelo", "azul", "fucsia", "laranja", "violeta"]);
		expect(defaultAccentTheme).toBe("atual");
		expect(accentThemes.atual).toMatchObject({ accent: "#FFFFFF", onAccent: "#000000" });
	});

	it("todo hex tem 6 dígitos em maiúsculas e todo tema tem nome em pt-BR", () => {
		for (const t of Object.values(accentThemes)) {
			expect(t.accent).toMatch(/^#[0-9A-F]{6}$/);
			expect(t.onAccent).toMatch(/^#[0-9A-F]{6}$/);
			expect(t.label.length).toBeGreaterThan(0);
		}
		expect(new Set(Object.values(accentThemes).map((t) => t.accent)).size).toBe(accentThemeKeys.length);
	});

	it.each(accentThemeKeys)("%s: texto sobre o accent passa AA (4,5:1)", (key) => {
		const t = accentThemes[key];
		expect(contrastRatio(t.onAccent, t.accent)).toBeGreaterThanOrEqual(4.5);
	});

	it.each(accentThemeKeys)("%s: o accent passa 3:1 sobre fundo, card e elemento de card", (key) => {
		const { accent } = accentThemes[key];
		for (const bg of [colors.background, colors.surface, colors.surface2]) {
			expect(contrastRatio(accent, bg)).toBeGreaterThanOrEqual(3);
		}
	});

	it("isAccentThemeKey só aceita chaves existentes", () => {
		expect(isAccentThemeKey("azul")).toBe(true);
		for (const bad of ["Azul", "", "toString", "__proto__", null, undefined, 3]) {
			expect(isAccentThemeKey(bad)).toBe(false);
		}
	});

	it("colors não tem mais accent fixo", () => {
		expect("accent" in colors).toBe(false);
		expect("onAccent" in colors).toBe(false);
	});
});
