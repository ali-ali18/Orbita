import { describe, expect, it } from "vitest";
import { brandGlyphs } from "./brand-glyphs.ts";

/** Glifos que vêm dos SVGs do theSVG (assets/brands/thesvg), já reduzidos a um caminho de 24 x 24. */
const FROM_THESVG = [
	"adobe",
	"amazon",
	"disneyplus",
	"grok",
	"mercadolivre",
	"microsoft",
	"openai",
	"primevideo",
];

describe("brandGlyphs", () => {
	it("tem os glifos do theSVG", () => {
		for (const id of FROM_THESVG) expect(brandGlyphs[id], id).toBeTruthy();
	});

	it("glifo do theSVG cabe em 24 x 24 e só tem comandos de caminho", () => {
		for (const id of FROM_THESVG) {
			const d = brandGlyphs[id] as string;
			expect(d, id).toMatch(/^M[-\d.\sMLHVCSQTAZ,]+$/i);
			const numbers = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
			expect(numbers.length).toBeGreaterThan(8);
			for (const n of numbers) expect(Math.abs(n), id).toBeLessThanOrEqual(24);
		}
	});
});
