import { describe, expect, it } from "vitest";
import { assertCents, formatBRL, parseBRL, sumCents } from "./money.ts";

describe("assertCents", () => {
	it("aceita inteiros seguros", () => {
		expect(() => assertCents(0)).not.toThrow();
		expect(() => assertCents(-5)).not.toThrow();
		expect(() => assertCents(Number.MAX_SAFE_INTEGER)).not.toThrow();
	});
	it("rejeita fração, NaN, infinito, não seguro e não número", () => {
		for (const v of [1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
			expect(() => assertCents(v)).toThrow(RangeError);
		}
		expect(() => assertCents("1")).toThrow(TypeError);
		expect(() => assertCents(0.1, "preço")).toThrow(/preço/);
	});
});

describe("sumCents", () => {
	it("soma e aceita lista vazia", () => {
		expect(sumCents([])).toBe(0);
		expect(sumCents([100, -30, 5])).toBe(75);
	});
	it("barra overflow e fração", () => {
		expect(() => sumCents([Number.MAX_SAFE_INTEGER, 1])).toThrow(RangeError);
		expect(() => sumCents([1.5])).toThrow(RangeError);
	});
});

describe("formatBRL", () => {
	it("agrupa milhares manualmente", () => {
		expect(formatBRL(123456)).toBe("R$ 1.234,56");
		expect(formatBRL(0)).toBe("R$ 0,00");
		expect(formatBRL(5)).toBe("R$ 0,05");
		expect(formatBRL(99999999)).toBe("R$ 999.999,99");
		expect(formatBRL(100000000)).toBe("R$ 1.000.000,00");
	});
	it("negativo usa o menos tipográfico", () => {
		expect(formatBRL(-4690)).toBe("−R$ 46,90");
	});
	it("modos de sinal", () => {
		expect(formatBRL(6, { sign: "always" })).toBe("+R$ 0,06");
		expect(formatBRL(-6, { sign: "always" })).toBe("−R$ 0,06");
		expect(formatBRL(-4690, { sign: "never" })).toBe("R$ 46,90");
		expect(formatBRL(4690, { sign: "auto" })).toBe("R$ 46,90");
	});
	it("rejeita não inteiro", () => {
		expect(() => formatBRL(1.5)).toThrow(RangeError);
	});
});

describe("parseBRL", () => {
	it.each([
		["46,90", 4690],
		["46", 4600],
		["1.234,56", 123456],
		["R$ 1.234,56", 123456],
		["R$1.234,56", 123456],
		["-46,90", -4690],
		["−46,90", -4690],
		["R$ -46,90", -4690],
		["46,9", 4690],
		["0,05", 5],
		["  12,00 ", 1200],
		["1.234", 123400],
	])("%s → %i", (text, cents) => {
		expect(parseBRL(text)).toBe(cents);
	});
	it.each(["46.90", "4,6,0", "", "   ", "abc", "1,234", "46,901", "1.23,45", "--4", "-R$ -4", "12,"])(
		"rejeita %j",
		(text) => {
			expect(() => parseBRL(text)).toThrow(RangeError);
		},
	);
	it("rejeita além do inteiro seguro", () => {
		expect(() => parseBRL("99.999.999.999.999.999,00")).toThrow(RangeError);
	});
	it("é inverso de formatBRL", () => {
		for (const c of [0, 1, 99, 100, 123456, -987654321, 100000000]) {
			expect(parseBRL(formatBRL(c))).toBe(c);
		}
	});
});
