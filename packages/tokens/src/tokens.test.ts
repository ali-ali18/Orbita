import { describe, expect, it } from "vitest";
import { banks, chart, chartSeries, colors, defaultCategoryColor, spacing, text } from "./index.ts";

const HEX = /^#[0-9A-F]{6}$/;

describe("tokens", () => {
	it("toda cor é hex de 6 dígitos em maiúsculas", () => {
		const all = [...Object.values(colors), ...Object.values(chart), ...Object.values(banks), ...chartSeries];
		for (const c of all) expect(c).toMatch(HEX);
	});

	it("a série do gráfico tem 5 cores distintas, nesta ordem", () => {
		expect([...chartSeries]).toEqual(["#3987E5", "#D95926", "#199E70", "#C98500", "#D55181"]);
		expect(new Set(chartSeries).size).toBe(5);
	});

	it("toda categoria mapeia para uma cor do gráfico", () => {
		const valid = new Set<string>(Object.values(chart));
		for (const c of Object.values(defaultCategoryColor)) expect(valid.has(c)).toBe(true);
		expect(defaultCategoryColor.outros).toBe(chart.other);
	});

	it("o espaçamento é crescente e múltiplo de 4", () => {
		const v = Object.values(spacing);
		expect(v).toEqual([...v].sort((a, b) => a - b));
		for (const n of v) expect(n % 4).toBe(0);
	});

	it("a altura de linha nunca é menor que o tamanho da fonte", () => {
		for (const s of Object.values(text)) expect(s.lineHeight).toBeGreaterThanOrEqual(s.fontSize);
	});
});
