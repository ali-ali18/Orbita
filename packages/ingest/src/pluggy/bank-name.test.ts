import { describe, expect, it } from "vitest";
import {
	bankIspb,
	cardDisplayName,
	cleanBankName,
	detectBankName,
	findKnownBank,
	hasMeuPluggyPrefix,
	isLegacyRawName,
	isMeuPluggyConnector,
	isWeakCardName,
} from "./bank-name.ts";

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
			["Nu Pagamentos S.A. - Instituição de Pagamento", "Nubank"],
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

describe("banco e nome de cartão", () => {
	it("findKnownBank acha o banco dentro de um nome maior", () => {
		expect(findKnownBank("Conta Corrente Inter")).toBe("Inter");
		expect(findKnownBank("MeuPluggy Nubank Mastercard Gold")).toBe("Nubank");
		expect(findKnownBank("Nu Pagamentos S.A. - Instituição de Pagamento")).toBe("Nubank");
		expect(findKnownBank("Banco Santander (Brasil) S.A.")).toBe("Santander");
		expect(findKnownBank("Mastercard Black")).toBeNull();
		expect(findKnownBank("Interessante")).toBeNull();
		expect(findKnownBank(null)).toBeNull();
	});

	it("isWeakCardName: letra solta ou só bandeira/nível", () => {
		for (const weak of ["G", "gb", "", "Mastercard Gold", "Cartão de Crédito", "VISA Platinum", "Black"]) {
			expect(isWeakCardName(weak)).toBe(true);
		}
		for (const ok of ["Nubank", "Cartão Ultravioleta Nubank", "Azul Itaú"]) {
			expect(isWeakCardName(ok)).toBe(false);
		}
	});

	it("detectBankName: conector de verdade, depois nomes das contas, depois o rótulo", () => {
		expect(detectBankName({ connectorName: "Nubank", accountNames: [] })).toBe("Nubank");
		expect(detectBankName({ connectorName: "MeuPluggy", accountNames: ["G", "Conta Corrente Inter"] })).toBe(
			"Inter",
		);
		expect(
			detectBankName({ connectorName: "MeuPluggy", accountNames: ["G"], connectionLabel: "Banco Xyz +1" }),
		).toBe("Banco Xyz");
		expect(
			detectBankName({ connectorName: "MeuPluggy", accountNames: ["G"], connectionLabel: "Conta Corrente" }),
		).toBeNull();
		expect(
			detectBankName({ connectorName: "MeuPluggy", accountNames: [], connectionLabel: "MeuPluggy" }),
		).toBeNull();
	});

	it("cardDisplayName: nome fraco vira o banco; nome bom ganha o banco só se não o cita", () => {
		expect(cardDisplayName("G", "Nubank")).toBe("Nubank");
		expect(cardDisplayName("Mastercard Gold", "Inter")).toBe("Inter");
		expect(cardDisplayName("Ultravioleta", "Nubank")).toBe("Nubank Ultravioleta");
		expect(cardDisplayName("Nubank Ultravioleta", "Nubank")).toBe("Nubank Ultravioleta");
		expect(cardDisplayName("G", null)).toBe("G");
	});
});

describe("Santander (conector Santander PF, cartão FREE VISA)", () => {
	it("variações do nome do conector viram Santander", () => {
		for (const raw of [
			"Santander",
			"Santander PF",
			"Banco Santander (Brasil) S.A.",
			"SANTANDER PARTICULARES",
		]) {
			expect(cleanBankName(raw)).toBe("Santander");
		}
	});

	it("produtos do Santander sem o nome do banco são reconhecidos pelo nome inteiro", () => {
		expect(findKnownBank("FREE VISA")).toBe("Santander");
		expect(findKnownBank("Unlimited Mastercard")).toBe("Santander");
		expect(findKnownBank("Free")).toBe("Santander");
		expect(findKnownBank("Free Shop Cartão")).toBeNull();
	});

	it("ISPB do emissor pelo nome curto", () => {
		expect(bankIspb("Santander")).toBe("90400888");
		expect(bankIspb("Nubank")).toBe("18236120");
		expect(bankIspb("Banco Desconhecido")).toBeNull();
		expect(bankIspb(null)).toBeNull();
	});
});

describe("isLegacyRawName", () => {
	it("não renomeia nome que o dono editou (raw curto com algo na frente)", () => {
		expect(isLegacyRawName("Roxinho gold", "gold")).toBe(false);
		expect(isLegacyRawName("Conta Santander", "Santander")).toBe(false);
		expect(isLegacyRawName("Cartão Mercado Pago", "Mercado Pago")).toBe(false);
		expect(isLegacyRawName("Meu FREE VISA", "FREE VISA")).toBe(false);
	});

	it("renomeia o nome igual à razão social crua, cortada ou com o banco na frente", () => {
		const raw = "Nu Pagamentos S.A. - Instituição de Pagamento";
		expect(isLegacyRawName(raw, raw)).toBe(true);
		expect(isLegacyRawName("Nubank Nu Pagamentos S.A. - Instituição de Pagamento", raw)).toBe(true);
		expect(isLegacyRawName("gold", "gold")).toBe(true);
		const longRaw = `${raw} ${"x".repeat(60)}`;
		expect(isLegacyRawName(longRaw.slice(0, 60), longRaw)).toBe(true);
	});
});
