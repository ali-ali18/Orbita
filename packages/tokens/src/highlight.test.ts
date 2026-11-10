import { describe, expect, it } from "vitest";
import { colors, contrastRatio, type HighlightLevel, highlight } from "./index.ts";

const LEVELS: HighlightLevel[] = ["subtle", "strong"];

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
	it("o padrão é a intensidade sutil", () => {
		expect(highlight.default).toBe("subtle");
	});

	it.each(LEVELS)("%s: opacidades entre 0 e 1 e medidas positivas", (level) => {
		const h = highlight[level];
		for (const o of [h.nearOpacity, h.farOpacity, h.glowOpacity]) {
			expect(o).toBeGreaterThan(0);
			expect(o).toBeLessThanOrEqual(1);
		}
		expect(h.strokeWidth).toBeGreaterThan(0);
		expect(h.strokeWidth).toBeLessThanOrEqual(2);
		expect(h.glowRadius).toBeGreaterThan(0);
	});

	it.each(LEVELS)("%s: a borda some antes do meio, então há um trecho sem borda", (level) => {
		expect(highlight[level].fadeAt).toBeGreaterThan(0);
		expect(highlight[level].fadeAt).toBeLessThan(0.5);
	});

	it.each(LEVELS)("%s: o canto oposto não brilha mais que o iluminado e a luz é fraca", (level) => {
		const h = highlight[level];
		expect(h.farOpacity).toBeLessThanOrEqual(h.nearOpacity);
		expect(h.glowOpacity).toBeLessThanOrEqual(0.1);
	});

	it("a marcante é mais forte que a sutil em tudo", () => {
		const { subtle, strong } = highlight;
		for (const k of Object.keys(subtle) as (keyof typeof subtle)[]) {
			expect(strong[k]).toBeGreaterThan(subtle[k]);
		}
	});

	// Pior caso: o ponto mais claro da luz (o canto). A luz é o branco de `colors.text`, igual em todos os temas.
	it.each(LEVELS)("%s: o texto do card mantém AA (4,5:1) sobre a luz", (level) => {
		const lit = over(colors.text, colors.surface, highlight[level].glowOpacity);
		expect(contrastRatio(colors.text, lit)).toBeGreaterThanOrEqual(4.5);
		expect(contrastRatio(colors.textSecondary, lit)).toBeGreaterThanOrEqual(4.5);
		expect(contrastRatio(colors.positive, lit)).toBeGreaterThanOrEqual(4.5);
	});
});
