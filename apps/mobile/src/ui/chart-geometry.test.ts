import { describe, expect, it } from "vitest";
import { donutArcs, linePath, project } from "./chart-geometry.ts";

const box = { width: 120, height: 60, pad: 10 };

describe("chart-geometry", () => {
	it("coloca a origem no canto de baixo à esquerda e o máximo no de cima à direita", () => {
		expect(project({ x: 0, y: 0 }, box, { xMax: 10, yMax: 100 })).toEqual({ x: 10, y: 50 });
		expect(project({ x: 10, y: 100 }, box, { xMax: 10, yMax: 100 })).toEqual({ x: 110, y: 10 });
	});

	it("não escapa da caixa quando o valor passa do máximo", () => {
		expect(project({ x: 5, y: 500 }, box, { xMax: 10, yMax: 100 }).y).toBe(10);
	});

	it("domínio vazio não gera NaN", () => {
		expect(project({ x: 1, y: 1 }, box, { xMax: 0, yMax: 0 })).toEqual({ x: 10, y: 50 });
	});

	it("monta o caminho M/L e devolve vazio sem pontos", () => {
		const d = linePath(
			[
				{ x: 0, y: 0 },
				{ x: 10, y: 100 },
			],
			box,
			{ xMax: 10, yMax: 100 },
		);
		expect(d).toBe("M10 50 L110 10");
		expect(linePath([], box, { xMax: 1, yMax: 1 })).toBe("");
	});
});

describe("donutArcs", () => {
	const r = 50;
	const c = 2 * Math.PI * r;

	it("divide a circunferência pelo peso e deixa folga entre os segmentos", () => {
		const arcs = donutArcs([1, 1], r, 10, 4);
		expect(arcs).toHaveLength(2);
		// Cada metade perde gap + espessura (14) e começa 7 depois do início da sua fatia.
		expect(arcs[0]?.length).toBeCloseTo(c / 2 - 14, 1);
		expect(arcs[0]?.start).toBeCloseTo(7, 1);
		expect(arcs[1]?.start).toBeCloseTo(c / 2 + 7, 1);
	});

	it("um segmento só fecha o anel, sem folga", () => {
		expect(donutArcs([0, 5], r, 10, 4)).toEqual([{ index: 1, length: Math.round(c * 100) / 100, start: 0 }]);
	});

	it("peso zero some e sem peso não há arco", () => {
		expect(donutArcs([], r, 10, 4)).toEqual([]);
		expect(donutArcs([0, -1], r, 10, 4)).toEqual([]);
	});

	it("segmento menor que a folga vira ponto sem encostar no vizinho", () => {
		const arcs = donutArcs([1, 1000], r, 10, 4);
		expect(arcs[0]?.length).toBe(1);
		const second = arcs[1];
		expect(second).toBeDefined();
		// O vizinho começa depois do ponto e a soma fecha a circunferência.
		expect((second?.start ?? 0) - 7).toBeCloseTo(15, 1);
		expect((second?.start ?? 0) - 7 + (second?.length ?? 0) + 14).toBeCloseTo(c, 1);
	});
});
