import { describe, expect, it } from "vitest";
import { linePath, project } from "./chart-geometry.ts";

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
