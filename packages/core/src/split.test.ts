import { describe, expect, it } from "vitest";
import { checkSplit, evenSplit, MAX_SPLIT_PARTS } from "./split.ts";

describe("checkSplit", () => {
	it("aceita partes que somam exatamente o total", () => {
		expect(checkSplit(4690, [3000, 1690])).toEqual({ ok: true, differenceCents: 0 });
	});

	it("diz quanto falta quando a soma é menor", () => {
		expect(checkSplit(4690, [3000, 1000])).toMatchObject({ ok: false, reason: "sum", differenceCents: 690 });
	});

	it("diz quanto sobra (negativo) quando a soma passa", () => {
		expect(checkSplit(4690, [3000, 2000])).toMatchObject({ ok: false, reason: "sum", differenceCents: -310 });
	});

	it("exige de 2 a 20 partes", () => {
		expect(checkSplit(100, [100])).toMatchObject({ ok: false, reason: "parts" });
		expect(checkSplit(100, [])).toMatchObject({ ok: false, reason: "parts" });
		const many = Array.from({ length: MAX_SPLIT_PARTS + 1 }, () => 1);
		expect(checkSplit(MAX_SPLIT_PARTS + 1, many)).toMatchObject({ ok: false, reason: "parts" });
		expect(checkSplit(MAX_SPLIT_PARTS, many.slice(0, MAX_SPLIT_PARTS)).ok).toBe(true);
	});

	it("rejeita parte zerada ou negativa mesmo que a soma feche", () => {
		expect(checkSplit(100, [100, 0])).toMatchObject({ ok: false, reason: "amount" });
		expect(checkSplit(100, [150, -50])).toMatchObject({ ok: false, reason: "amount" });
	});

	it("falha cedo com dinheiro fracionado ou total inválido", () => {
		expect(() => checkSplit(100, [50.5, 49.5])).toThrow(RangeError);
		expect(() => checkSplit(10.5, [5, 5])).toThrow(RangeError);
		expect(() => checkSplit(0, [1, 1])).toThrow(RangeError);
	});
});

describe("evenSplit", () => {
	it("o resto dos centavos vai para a primeira e a soma fecha", () => {
		expect(evenSplit(10000, 3)).toEqual([3334, 3333, 3333]);
		for (const [total, n] of [
			[4690, 2],
			[2, 2],
			[999, 7],
		] as const) {
			expect(checkSplit(total, evenSplit(total, n)).ok).toBe(true);
		}
	});

	it("rejeita contagem fora do limite e total menor que as partes", () => {
		expect(() => evenSplit(100, 1)).toThrow(RangeError);
		expect(() => evenSplit(100, 21)).toThrow(RangeError);
		expect(() => evenSplit(1, 2)).toThrow(RangeError);
	});
});
