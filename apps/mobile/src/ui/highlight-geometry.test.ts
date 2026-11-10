import { highlight, radius } from "@orbita/tokens";
import { describe, expect, it } from "vitest";
import { highlightGeometry, highlightOpacityAt, highlightPosition } from "./highlight-geometry.ts";

const spec = highlight.subtle;
const wide = { width: 358, height: 200, radius: radius.card, ...spec };

describe("highlightGeometry", () => {
	it("sem tamanho medido não desenha nada", () => {
		expect(highlightGeometry({ ...wide, width: 0 })).toBeNull();
		expect(highlightGeometry({ ...wide, height: 0 })).toBeNull();
		expect(highlightGeometry({ ...wide, width: Number.NaN })).toBeNull();
	});

	it("o traço fica todo dentro do card, com o raio descontado da meia espessura", () => {
		const g = highlightGeometry({ ...wide, strokeWidth: 2 });
		expect(g?.rect).toEqual({ x: 1, y: 1, width: 356, height: 198, rx: 27 });
	});

	it("card baixo: o raio não passa da metade da altura", () => {
		const g = highlightGeometry({ ...wide, height: 40, strokeWidth: 2 });
		expect(g?.rect.rx).toBe(19);
	});

	it.each([
		["largo", 358, 200],
		["quadrado", 171, 171],
		["alto", 171, 400],
	])("%s: canto iluminado em 0, oposto em 1 e os outros dois no meio", (_name, width, height) => {
		const g = highlightGeometry({ ...wide, width, height });
		if (!g) throw new Error("sem geometria");
		expect(highlightPosition({ x: 0, y: 0 }, g.line)).toBeCloseTo(0, 2);
		expect(highlightPosition({ x: width, y: height }, g.line)).toBeCloseTo(1, 2);
		expect(highlightPosition({ x: width, y: 0 }, g.line)).toBeCloseTo(0.5, 2);
		expect(highlightPosition({ x: 0, y: height }, g.line)).toBeCloseTo(0.5, 2);
		// Anda por igual nas arestas: metade da de cima é um quarto do caminho.
		expect(highlightPosition({ x: width / 2, y: 0 }, g.line)).toBeCloseTo(0.25, 2);
		expect(highlightPosition({ x: 0, y: height / 2 }, g.line)).toBeCloseTo(0.25, 2);
	});

	it("a borda é forte no canto, some antes do meio e reaparece no canto oposto", () => {
		const g = highlightGeometry(wide);
		if (!g) throw new Error("sem geometria");
		expect(g.stops).toEqual([
			{ offset: 0, opacity: spec.nearOpacity },
			{ offset: spec.fadeAt, opacity: 0 },
			{ offset: 1 - spec.fadeAt, opacity: 0 },
			{ offset: 1, opacity: spec.farOpacity },
		]);
		const at = (x: number, y: number) => highlightOpacityAt(highlightPosition({ x, y }, g.line), g.stops);
		expect(at(0, 0)).toBeCloseTo(spec.nearOpacity, 2);
		// Os dois cantos do meio e o trecho em volta deles ficam sem borda.
		expect(at(358, 0)).toBe(0);
		expect(at(0, 200)).toBe(0);
		expect(at(358 * 0.7, 0)).toBe(0);
		expect(at(358, 200 * 0.3)).toBe(0);
		// Diminui ao longo da aresta de cima e da esquerda.
		expect(at(60, 0)).toBeGreaterThan(at(150, 0));
		expect(at(0, 40)).toBeGreaterThan(at(0, 100));
		expect(at(150, 0)).toBeGreaterThan(0);
		// Volta no canto de baixo à direita, crescendo em direção a ele.
		expect(at(358, 200)).toBeCloseTo(spec.farOpacity, 2);
		expect(at(300, 200)).toBeGreaterThan(at(200, 200));
		expect(at(200, 200)).toBeGreaterThan(0);
	});

	it("fadeAt fora da faixa não cruza o meio", () => {
		const g = highlightGeometry({ ...wide, fadeAt: 0.9 });
		expect(g?.stops.map((s) => s.offset)).toEqual([0, 0.5, 0.5, 1]);
	});

	it("a luz nasce no canto iluminado e o raio acompanha a largura", () => {
		const g = highlightGeometry(wide);
		expect(g?.glow).toEqual({ cx: 0, cy: 0, r: 286.4, opacity: spec.glowOpacity });
	});
});
