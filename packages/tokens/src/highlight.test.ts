import { describe, expect, it } from "vitest";
import { colors, contrastRatio, highlight } from "./index.ts";

/** Cor que se vê quando `fg` com opacidade `alpha` cobre `bg` (mistura por canal, como a tela faz). */
function over(fg: string, bg: string, alpha: number): string {
	const mix = [1, 3, 5].map((i) => {
		const f = Number.parseInt(fg.slice(i, i + 2), 16);
		const b = Number.parseInt(bg.slice(i, i + 2), 16);
		return Math.round(b + (f - b) * alpha)
			.toString(16)
			.padStart(2, "0");
	});
	return `#${mix.join("").toUpperCase()}`;
}

describe("highlight", () => {
	it("opacidades entre 0 e 1 e medidas positivas", () => {
		for (const o of [highlight.nearOpacity, highlight.farOpacity, highlight.glowOpacity]) {
			expect(o).toBeGreaterThan(0);
			expect(o).toBeLessThanOrEqual(1);
		}
		expect(highlight.glowRadius).toBeGreaterThan(0);
	});

	it("o traço é um fio: mais fino que 1 px, sem sumir", () => {
		expect(highlight.strokeWidth).toBeGreaterThanOrEqual(0.5);
		expect(highlight.strokeWidth).toBeLessThan(1);
	});

	it("a borda some antes do meio, então há um trecho sem borda", () => {
		expect(highlight.fadeAt).toBeGreaterThan(0);
		expect(highlight.fadeAt).toBeLessThan(0.5);
	});

	it("é delicado: o canto iluminado não passa de 0,6, o oposto é mais fraco e a luz é mínima", () => {
		expect(highlight.nearOpacity).toBeLessThanOrEqual(0.6);
		expect(highlight.farOpacity).toBeLessThan(highlight.nearOpacity);
		expect(highlight.glowOpacity).toBeLessThanOrEqual(0.05);
	});

	// Pior caso: o ponto mais claro da luz (o canto). A luz é o branco de `colors.text`, igual em todos os temas.
	it("o texto do card mantém AA (4,5:1) sobre a luz", () => {
		const lit = over(colors.text, colors.surface, highlight.glowOpacity);
		expect(contrastRatio(colors.text, lit)).toBeGreaterThanOrEqual(4.5);
		expect(contrastRatio(colors.textSecondary, lit)).toBeGreaterThanOrEqual(4.5);
		expect(contrastRatio(colors.positive, lit)).toBeGreaterThanOrEqual(4.5);
	});
});
