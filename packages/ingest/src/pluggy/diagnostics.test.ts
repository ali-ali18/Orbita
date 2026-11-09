import { describe, expect, it } from "vitest";
import { lastDigits, safeText } from "./diagnostics.ts";

describe("redação do diagnóstico", () => {
	it("lastDigits guarda só o fim", () => {
		expect(lastDigits("5502 1234 5678 4321", 4)).toBe("•••4321");
		expect(lastDigits("123.456.789-00", 3)).toBe("•••900");
		expect(lastDigits("sem número", 4)).toBeNull();
		expect(lastDigits(null, 4)).toBeNull();
	});

	it("safeText mascara sequências longas de dígitos, mesmo com separadores", () => {
		expect(safeText("Pix 123.456.789-00 para 12.345.678/0001-95")).toBe("Pix •••900 para •••195");
		expect(safeText("cartão 5502 1234 5678 4321")).toBe("cartão •••321");
		expect(safeText("COMPRA 03/11/2026 parcela 3/10")).toBe("COMPRA 03/11/2026 parcela 3/10");
	});

	it("safeText apara, tira controle e limita o tamanho", () => {
		expect(safeText("  a\u0000b\n c  ")).toBe("a b c");
		expect(safeText("   ")).toBeNull();
		expect(safeText("x".repeat(200))?.length).toBe(121);
	});
});
