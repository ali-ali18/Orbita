import { describe, expect, it } from "vitest";
import { passedThreshold, suggestBudget } from "./budget-suggestion.ts";

describe("suggestBudget", () => {
	it("mediana dos meses por categoria, em reais inteiros", () => {
		const r = suggestBudget([
			{ mercado: 80000, lazer: 10000 },
			{ mercado: 90050, lazer: 90000 },
			{ mercado: 85000, lazer: 20000 },
		]);
		expect(r.byCategory).toEqual({ lazer: 20000, mercado: 85000 });
		expect(r.totalCents).toBe(105000);
		expect(r.monthsUsed).toBe(3);
	});
	it("um mês atípico não puxa a sugestão", () => {
		const r = suggestBudget([{ a: 50000 }, { a: 50000 }, { a: 900000 }]);
		expect(r.byCategory.a).toBe(50000);
	});
	it("arredonda para o real mais próximo (meio real sobe)", () => {
		expect(suggestBudget([{ a: 10049 }]).byCategory.a).toBe(10000);
		expect(suggestBudget([{ a: 10050 }]).byCategory.a).toBe(10100);
	});
	it("com 2 meses, a mediana é a média dos dois", () => {
		expect(suggestBudget([{ a: 10000 }, { a: 20100 }]).byCategory.a).toBe(15100);
	});
	it("categoria ausente num mês usado conta como zero", () => {
		const r = suggestBudget([{ a: 10000, b: 30000 }, { a: 10000 }, { a: 10000 }]);
		expect(r.byCategory).toEqual({ a: 10000 });
	});
	it("mês sem gasto é ignorado; sem nenhum mês, nada a sugerir", () => {
		expect(suggestBudget([{}, { a: 30000 }, { a: 0 }])).toEqual({
			byCategory: { a: 30000 },
			totalCents: 30000,
			monthsUsed: 1,
		});
		expect(suggestBudget([])).toEqual({ byCategory: {}, totalCents: 0, monthsUsed: 0 });
	});
	it("estorno líquido negativo não vira gasto; abaixo de meio real some", () => {
		expect(
			suggestBudget([
				{ a: -500, b: 40 },
				{ a: 20000, b: 40 },
			]).byCategory,
		).toEqual({ a: 10000 });
	});
	it("recusa centavos fracionados", () => {
		expect(() => suggestBudget([{ a: 10.5 }])).toThrow(RangeError);
	});
});

describe("passedThreshold", () => {
	const t = (spentCents: number, limitCents = 10000, thresholdPercent = 80) =>
		passedThreshold({ limitCents, spentCents, thresholdPercent });
	it("passar é estritamente acima", () => {
		expect(t(8000)).toBe(false);
		expect(t(8001)).toBe(true);
		expect(t(7999)).toBe(false);
	});
	it("em 100% equivale a estourar", () => {
		expect(t(10000, 10000, 100)).toBe(false);
		expect(t(10001, 10000, 100)).toBe(true);
	});
	it("limite zero: qualquer gasto passa; sem gasto não", () => {
		expect(t(1, 0)).toBe(true);
		expect(t(0, 0)).toBe(false);
	});
	it("valida o percentual e os centavos", () => {
		expect(() => t(1, 100, 0)).toThrow(RangeError);
		expect(() => t(1, 100, 101)).toThrow(RangeError);
		expect(() => t(1, 100, 80.5)).toThrow(RangeError);
		expect(() => t(1.5)).toThrow(RangeError);
	});
});
