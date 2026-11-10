import { describe, expect, it } from "vitest";
import { DEFAULT_CHART_VIEWS, parseChartViews, serializeChartViews, withChartView } from "./chart-view.ts";

describe("Ver como (escolha guardada)", () => {
	it("Instituições abre em barras e Classes em rosca", () => {
		expect(parseChartViews(null)).toEqual({ classes: "donut", institutions: "bars" });
	});

	it("guarda e lê a escolha de cada gráfico separadamente", () => {
		const chosen = withChartView(DEFAULT_CHART_VIEWS, "institutions", "hbars");
		expect(parseChartViews(serializeChartViews(chosen))).toEqual({ classes: "donut", institutions: "hbars" });
	});

	it("escolher o que já está não cria estado novo", () => {
		expect(withChartView(DEFAULT_CHART_VIEWS, "classes", "donut")).toBe(DEFAULT_CHART_VIEWS);
	});

	it("texto quebrado, formato errado ou valor desconhecido voltam ao padrão", () => {
		expect(parseChartViews("{nao json")).toEqual(DEFAULT_CHART_VIEWS);
		expect(parseChartViews("[]")).toEqual(DEFAULT_CHART_VIEWS);
		expect(parseChartViews('"bars"')).toEqual(DEFAULT_CHART_VIEWS);
		expect(parseChartViews('{"classes":"pizza","institutions":"hbars"}')).toEqual({
			classes: "donut",
			institutions: "hbars",
		});
	});
});
