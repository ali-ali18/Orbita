import { highlight, radius } from "@orbita/tokens";
import { describe, expect, it } from "vitest";
import {
	type HighlightGeometry,
	highlightApplies,
	highlightGeometry,
	highlightOpacityAt,
	highlightPosition,
	measuredSize,
} from "./highlight-geometry.ts";

const spec = highlight;
const wide = { width: 358, height: 212, radius: radius.card, ...spec, bleed: 0 };

function geometry(input: Parameters<typeof highlightGeometry>[0]): HighlightGeometry {
	const g = highlightGeometry(input);
	if (!g) throw new Error("sem geometria");
	return g;
}

/** Opacidade da borda num ponto do card (coordenadas do card, sem a folga). */
function opacityAt(g: HighlightGeometry, x: number, y: number): number {
	return highlightOpacityAt(highlightPosition({ x: x + g.card.x, y: y + g.card.y }, g.line), g.stops);
}

describe("highlightGeometry", () => {
	it("sem tamanho medido não desenha nada", () => {
		expect(highlightGeometry({ ...wide, width: 0 })).toBeNull();
		expect(highlightGeometry({ ...wide, height: 0 })).toBeNull();
		expect(highlightGeometry({ ...wide, width: Number.NaN })).toBeNull();
	});

	it("o traço fica todo dentro do card, com o raio descontado da meia espessura", () => {
		const g = geometry({ ...wide, strokeWidth: 2 });
		expect(g.rect).toEqual({ x: 1, y: 1, width: 356, height: 210, rx: 27 });
	});

	it("card baixo: o raio não passa da metade da altura", () => {
		expect(geometry({ ...wide, height: 40, strokeWidth: 2 }).rect.rx).toBe(19);
	});

	it("com folga, a tela cresce dos dois lados e o desenho inteiro se desloca junto", () => {
		const flat = geometry(wide);
		const g = geometry({ ...wide, bleed: 4 });
		expect(g.canvas).toEqual({ width: 366, height: 220 });
		expect(g.card).toEqual({ x: 4, y: 4, width: 358, height: 212, rx: 28 });
		expect(g.rect.x).toBe(flat.rect.x + 4);
		expect(g.rect.y).toBe(flat.rect.y + 4);
		expect(g.rect.width).toBe(flat.rect.width);
		expect(g.rect.height).toBe(flat.rect.height);
		expect(g.line.x1).toBe(4);
		expect(g.line.y1).toBe(4);
		expect(g.glow.cx).toBe(4);
		// A borda de baixo e a da direita ficam longe do fim da tela: nada rente ao corte.
		expect(g.canvas.height - (g.rect.y + g.rect.height)).toBeGreaterThan(spec.strokeWidth * 2);
		expect(g.canvas.width - (g.rect.x + g.rect.width)).toBeGreaterThan(spec.strokeWidth * 2);
		// E a aparência não muda: mesma opacidade nos mesmos pontos do card.
		for (const [x, y] of [
			[0, 0],
			[100, 0],
			[0, 60],
			[358, 212],
			[300, 212],
			[358, 150],
		] as const) {
			expect(opacityAt(g, x, y)).toBeCloseTo(opacityAt(flat, x, y), 3);
		}
	});

	it("card largo e baixo (o do Início): acende no canto, some no alcance e volta no canto oposto", () => {
		const g = geometry(wide);
		expect(g.reach).toEqual({ x: spec.reachX, y: spec.reachY });
		expect(opacityAt(g, 0, 0)).toBeCloseTo(spec.nearOpacity, 3);
		// Some exatamente no alcance, nas duas arestas do canto iluminado.
		expect(opacityAt(g, spec.reachX, 0)).toBeCloseTo(0, 3);
		expect(opacityAt(g, 0, spec.reachY)).toBeCloseTo(0, 3);
		expect(opacityAt(g, spec.reachX / 2, 0)).toBeCloseTo(spec.nearOpacity / 2, 3);
		expect(opacityAt(g, 0, spec.reachY / 2)).toBeCloseTo(spec.nearOpacity / 2, 3);
		// Os outros dois cantos ficam sem borda.
		expect(opacityAt(g, 358, 0)).toBe(0);
		expect(opacityAt(g, 0, 212)).toBe(0);
		// Canto oposto, espelhado.
		expect(opacityAt(g, 358, 212)).toBeCloseTo(spec.farOpacity, 3);
		expect(opacityAt(g, 358 - spec.reachX, 212)).toBeCloseTo(0, 3);
		expect(opacityAt(g, 358, 212 - spec.reachY)).toBeCloseTo(0, 3);
		expect(opacityAt(g, 358 - spec.reachX / 2, 212)).toBeCloseTo(spec.farOpacity / 2, 3);
	});

	it.each([
		["alto (Gastos por categoria)", 358, 900],
		["muito alto", 328, 2400],
		["quadrado", 358, 358],
		["largo", 700, 212],
	])(
		"%s: o trecho aceso tem o mesmo comprimento em px, qualquer que seja a proporção",
		(_n, width, height) => {
			const g = geometry({ ...wide, width, height });
			expect(g.reach).toEqual({ x: spec.reachX, y: spec.reachY });
			// Canto oposto: a aresta direita acende só `reachY` px, não uma fração da altura.
			expect(opacityAt(g, width, height)).toBeCloseTo(spec.farOpacity, 3);
			expect(opacityAt(g, width, height - spec.reachY)).toBeCloseTo(0, 3);
			expect(opacityAt(g, width, height - spec.reachY - 1)).toBe(0);
			expect(opacityAt(g, width, height - spec.reachY - 20)).toBe(0);
			expect(opacityAt(g, width - spec.reachX, height)).toBeCloseTo(0, 3);
			expect(opacityAt(g, width - spec.reachX - 1, height)).toBe(0);
			// Canto iluminado, igual.
			expect(opacityAt(g, 0, spec.reachY)).toBeCloseTo(0, 3);
			expect(opacityAt(g, 0, spec.reachY + 20)).toBe(0);
			expect(opacityAt(g, spec.reachX, 0)).toBeCloseTo(0, 3);
		},
	);

	it("card alto: as duas pontas esmaecem até zero sem degrau", () => {
		const width = 358;
		const height = 900;
		const g = geometry({ ...wide, width, height });
		// Anda px a px pela aresta de baixo e pela direita, do canto oposto para fora: nunca sobe, nunca pula.
		const walks = [
			Array.from({ length: 300 }, (_, i) => opacityAt(g, width - i, height)),
			Array.from({ length: 300 }, (_, i) => opacityAt(g, width, height - i)),
			Array.from({ length: 300 }, (_, i) => opacityAt(g, i, 0)),
			Array.from({ length: 300 }, (_, i) => opacityAt(g, 0, i)),
		];
		for (const walk of walks) {
			for (let i = 1; i < walk.length; i++) {
				const step = (walk[i - 1] as number) - (walk[i] as number);
				expect(step).toBeGreaterThanOrEqual(0);
				expect(step).toBeLessThan(0.01);
			}
			expect(walk[walk.length - 1]).toBe(0);
		}
	});

	it.each([
		["largo", 358, 212],
		["alto", 358, 900],
		["muito alto", 328, 2400],
		["baixinho", 358, 64],
		["estreito", 120, 300],
	])(
		"%s: as paradas crescem, as duas transparentes não coincidem e o meio fica sem borda",
		(_n, width, height) => {
			const { stops } = geometry({ ...wide, width, height });
			expect(stops.map((s) => s.opacity)).toEqual([spec.nearOpacity, 0, 0, spec.farOpacity]);
			const offsets = stops.map((s) => s.offset);
			expect(offsets[0]).toBe(0);
			expect(offsets[3]).toBe(1);
			for (let i = 1; i < offsets.length; i++) {
				expect((offsets[i] as number) - (offsets[i - 1] as number)).toBeGreaterThan(0.001);
			}
			expect((offsets[2] as number) - (offsets[1] as number)).toBeGreaterThan(0.1);
		},
	);

	it("card pequeno: o alcance encolhe para caber e os outros cantos seguem sem borda", () => {
		const g = geometry({ ...wide, width: 220, height: 64 });
		expect(g.reach).toEqual({ x: 220 * spec.reachMaxRatio, y: 64 * spec.reachMaxRatio });
		expect(opacityAt(g, 220, 0)).toBe(0);
		expect(opacityAt(g, 0, 64)).toBe(0);
		expect(opacityAt(g, 0, 0)).toBeCloseTo(spec.nearOpacity, 3);
		expect(opacityAt(g, 220, 64)).toBeCloseTo(spec.farOpacity, 3);
	});

	it("a luz nasce no canto iluminado e o raio acompanha a largura", () => {
		expect(geometry(wide).glow).toEqual({ cx: 0, cy: 0, r: 286.4, opacity: spec.glowOpacity });
	});
});

describe("highlightApplies", () => {
	const ratio = highlight.minWidthRatio;

	it("card de largura cheia recebe (tela de 390 com margem de 16)", () => {
		expect(highlightApplies(358, 390, ratio)).toBe(true);
	});

	it("widget 2x2 e par lado a lado não recebem", () => {
		expect(highlightApplies(173, 390, ratio)).toBe(false);
		expect(highlightApplies(160, 360, ratio)).toBe(false);
	});

	it("sem medida não recebe", () => {
		expect(highlightApplies(0, 390, ratio)).toBe(false);
		expect(highlightApplies(358, 0, ratio)).toBe(false);
	});
});

describe("measuredSize", () => {
	it("a primeira medida vale", () => {
		expect(measuredSize(null, { width: 358, height: 212 })).toEqual({ width: 358, height: 212 });
	});

	it("card que cresce depois de montado (dados chegaram): vale a medida nova, até por menos de 1 px", () => {
		const first = { width: 358, height: 212 };
		expect(measuredSize(first, { width: 358, height: 640 })).toEqual({ width: 358, height: 640 });
		expect(measuredSize(first, { width: 358, height: 212.33 })).toEqual({ width: 358, height: 212.33 });
		expect(measuredSize(first, { width: 357.67, height: 212 })).toEqual({ width: 357.67, height: 212 });
	});

	it("medida igual devolve o mesmo objeto (não redesenha)", () => {
		const first = { width: 358, height: 212 };
		expect(measuredSize(first, { width: 358, height: 212 })).toBe(first);
	});

	it("a geometria acompanha a medida nova: a borda de baixo desce junto com o card", () => {
		const base = { radius: radius.card, ...highlight, bleed: highlight.bleed };
		const before = geometry({ ...base, ...measuredSize(null, { width: 358, height: 212 }) });
		const after = geometry({
			...base,
			...measuredSize({ width: 358, height: 212 }, { width: 358, height: 640 }),
		});
		expect(after.rect.height - before.rect.height).toBe(428);
		expect(after.canvas.height).toBe(640 + highlight.bleed * 2);
	});
});
