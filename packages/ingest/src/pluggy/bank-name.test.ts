import { describe, expect, it } from "vitest";
import { cleanBankName, hasMeuPluggyPrefix, isMeuPluggyConnector } from "./bank-name.ts";

describe("cleanBankName", () => {
	it("tira o prefixo MeuPluggy (qualquer caixa, com ou sem espaço)", () => {
		expect(cleanBankName("MeuPluggy Mercado Pago")).toBe("Mercado Pago");
		expect(cleanBankName("meupluggy BANCO INTER")).toBe("Inter");
		expect(cleanBankName("Meu Pluggy - Banco Santander (Brasil) S.A.")).toBe("Santander");
		expect(cleanBankName("MeuPluggyInter")).toBe("MeuPluggyInter"); // sem fronteira de palavra: não é o prefixo
	});

	it("simplifica os bancos comuns", () => {
		for (const [raw, out] of [
			["Banco Santander (Brasil) S.A.", "Santander"],
			["BANCO INTER", "Inter"],
			["Nu Pagamentos S.A.", "Nubank"],
			["ITAÚ UNIBANCO S.A.", "Itaú"],
			["Banco Bradesco S.A.", "Bradesco"],
			["BANCO DO BRASIL S.A.", "Banco do Brasil"],
			["Caixa Econômica Federal", "Caixa"],
			["Banco C6 S.A.", "C6"],
			["Banco BTG Pactual S.A.", "BTG"],
			["PicPay", "PicPay"],
		] as const) {
			expect(cleanBankName(raw), raw).toBe(out);
		}
	});

	it("mantém o que não é só o banco e põe Title Case no que veio em caixa alta", () => {
		expect(cleanBankName("MeuPluggy Mercado Pago Conta Corrente")).toBe("Mercado Pago Conta Corrente");
		expect(cleanBankName("Mastercard Black")).toBe("Mastercard Black");
		expect(cleanBankName("BANCO XYZ DE INVESTIMENTOS")).toBe("Banco XYZ de Investimentos");
		expect(cleanBankName("MeuPluggy BANC…")).toBe("BANC…");
		expect(cleanBankName("  MeuPluggy  ")).toBe("");
		expect(cleanBankName("BANCO BMG")).toBe("Banco BMG");
		expect(cleanBankName("BANCO PAN S.A. BRASIL")).toBe("Banco PAN S.A. Brasil");
		expect(cleanBankName("Mastercard Black")).toBe("Mastercard Black");
	});

	it("tira invisíveis e repetição do prefixo", () => {
		expect(cleanBankName("\u200b MeuPluggy \u202e Inter\u200b")).toBe("Inter");
		expect(cleanBankName("\u200b\u200f \u2060")).toBe("");
		expect(cleanBankName("MeuPluggy MeuPluggy Mercado Pago")).toBe("Mercado Pago");
		expect(cleanBankName("meu pluggy - MeuPluggy Nubank")).toBe("Nubank");
	});
});

describe("prefixo e conector", () => {
	it("reconhece", () => {
		expect(hasMeuPluggyPrefix("MeuPluggy Inter")).toBe(true);
		expect(hasMeuPluggyPrefix("Meu pluggy")).toBe(true);
		expect(hasMeuPluggyPrefix("Nubank Conta")).toBe(false);
		expect(isMeuPluggyConnector("MeuPluggy")).toBe(true);
		expect(isMeuPluggyConnector("Nubank")).toBe(false);
		expect(isMeuPluggyConnector(null)).toBe(false);
	});
});
