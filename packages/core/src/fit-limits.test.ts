import { describe, expect, it } from "vitest";
import { scaleDownToFit } from "./fit-limits.ts";

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

describe("scaleDownToFit", () => {
	it("o que já cabe fica igual", () => {
		expect(scaleDownToFit({ a: 100, b: 200 }, 300)).toEqual({ a: 100, b: 200 });
	});
	it("reduz proporcionalmente e a soma fecha exatamente no teto", () => {
		const r = scaleDownToFit({ a: 100000, b: 100000, c: 100000 }, 100000);
		expect(sum(r)).toBe(100000);
		// 33333,33 cada: o centavo que sobra vai para o menor id.
		expect(r).toEqual({ a: 33334, b: 33333, c: 33333 });
	});
	it("o resto vai para a maior fração perdida; empate pelo id", () => {
		const r = scaleDownToFit({ a: 10, b: 20, c: 30 }, 31);
		expect(sum(r)).toBe(31);
		expect(scaleDownToFit({ z: 5, y: 5 }, 5)).toEqual({ y: 3, z: 2 });
	});
	it("a parte travada nunca encolhe", () => {
		const r = scaleDownToFit({ moradia: 80000, lazer: 60000 }, 100000, { moradia: 80000 });
		expect(r).toEqual({ moradia: 80000, lazer: 20000 });
	});
	it("nem o travado cabe: devolve o travado e zera o resto", () => {
		expect(scaleDownToFit({ a: 90000, b: 50000 }, 50000, { a: 90000 })).toEqual({ a: 90000, b: 0 });
	});
	it("não estoura o inteiro seguro com valores grandes", () => {
		const r = scaleDownToFit({ a: 9_000_000_000_000, b: 9_000_000_000_000 }, 9_000_000_000_001);
		expect(sum(r)).toBe(9_000_000_000_001);
	});
	it("recusa centavos fracionários e teto negativo", () => {
		expect(() => scaleDownToFit({ a: 1.5 }, 1)).toThrow();
		expect(() => scaleDownToFit({ a: 1 }, -1)).toThrow();
	});
});
