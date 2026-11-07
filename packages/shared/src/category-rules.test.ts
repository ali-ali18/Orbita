import { describe, expect, it } from "vitest";
import {
	cleanExternalLabel,
	derivePattern,
	normalizeMerchantName,
	patternMatches,
	pickCategoryRule,
} from "./category-rules.ts";

describe("normalizeMerchantName", () => {
	it.each([
		["Pix enviado - Rei Dos Lanches 12/11", "rei dos lanches"],
		["PIX ENVIADO - REI DOS LANCHES", "rei dos lanches"],
		["Pix recebido: João da Silva", "joao da silva"],
		["Transferência enviada pelo Pix - Padaria São João", "padaria sao joao"],
		["Compra no débito - Mercado Extra 03/11", "mercado extra"],
		["COMPRA NO DEBITO MERCADO EXTRA", "mercado extra"],
		["Compra no crédito  Posto Ipiranga  *1234", "posto ipiranga"],
		["Pagamento de boleto - Condomínio Bela Vista", "condominio bela vista"],
		["Pagamento Pix QR Code Cafeteria Central", "cafeteria central"],
		["UBER *TRIP 8F2K91AB3", "uber trip"],
		["Netflix.com", "netflix com"],
		["Amazon Prime 3/12", "amazon prime"],
		["Loja Tal - Parcela 3 de 10", "loja tal"],
		["TED enviada - 123456789 Maria", "maria"],
		["Pix enviado - ***.123.456-** Fulano de Tal", "fulano de tal"],
		["iFood  ", "ifood"],
	])("%s → %s", (raw, expected) => {
		expect(normalizeMerchantName(raw)).toBe(expected);
	});

	it("vazio quando só sobra prefixo, data ou código", () => {
		expect(normalizeMerchantName("Pix enviado")).toBe("");
		expect(normalizeMerchantName("12/11 123456789")).toBe("");
		expect(normalizeMerchantName(null)).toBe("");
		expect(normalizeMerchantName(undefined)).toBe("");
	});

	it("limita o tamanho cortando em palavra inteira", () => {
		const out = normalizeMerchantName(`${"palavra ".repeat(20)}`);
		expect(out.length).toBeLessThanOrEqual(60);
		expect(out.endsWith("palavra")).toBe(true);
	});

	it("é idempotente", () => {
		const once = normalizeMerchantName("Pix enviado - Rei Dos Lanches 12/11");
		expect(normalizeMerchantName(once)).toBe(once);
	});
});

describe("derivePattern e casamento", () => {
	it("prefere o primeiro texto que rende nome de pelo menos 3 letras", () => {
		expect(derivePattern("Rei dos Lanches Ltda", "Pix enviado - outro")).toBe("rei dos lanches ltda");
		expect(derivePattern("ab", "Pix enviado - Padaria")).toBe("padaria");
		expect(derivePattern(null, "Pix enviado")).toBeNull();
	});

	it("casa palavras inteiras, não pedaços", () => {
		expect(patternMatches("uber", "uber trip")).toBe(true);
		expect(patternMatches("uber", "suberbo")).toBe(false);
		expect(patternMatches("rei dos lanches", "rei dos lanches ltda")).toBe(true);
		expect(patternMatches("", "x")).toBe(false);
	});

	it("a regra mais específica (padrão mais longo) vence", () => {
		const rules = [
			{ pattern: "uber", categoryId: "transporte" },
			{ pattern: "uber eats", categoryId: "delivery" },
		];
		expect(pickCategoryRule(rules, "UBER EATS SAO PAULO")?.categoryId).toBe("delivery");
		expect(pickCategoryRule(rules, "Uber *Trip")?.categoryId).toBe("transporte");
		expect(pickCategoryRule(rules, "Padaria")).toBeNull();
	});

	it("olha o nome do estabelecimento e a descrição", () => {
		const rules = [{ pattern: "rei dos lanches", categoryId: "delivery" }];
		expect(pickCategoryRule(rules, "Rei dos Lanches", "Pix enviado - X")?.categoryId).toBe("delivery");
		expect(pickCategoryRule(rules, null, "Pix enviado - Rei dos Lanches")?.categoryId).toBe("delivery");
	});
});

describe("cleanExternalLabel", () => {
	it("tira controle, junta espaços, limita e devolve null se vazio", () => {
		expect(cleanExternalLabel("  A\u0000  B​ ", 10)).toBe("A B");
		expect(cleanExternalLabel("abcdefghij", 5)).toBe("abcd…");
		expect(cleanExternalLabel("   ", 5)).toBeNull();
		expect(cleanExternalLabel(null, 5)).toBeNull();
	});
});
