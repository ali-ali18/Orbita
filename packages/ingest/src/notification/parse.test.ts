import type { NotificationApp } from "@orbita/shared";
import { describe, expect, it } from "vitest";
import { type ParseResult, parseNotification } from "./parse.ts";

const parse = (app: NotificationApp, text: string, title = ""): ParseResult =>
	parseNotification({ app, title, text });

const parsed = (r: ParseResult) => {
	if (r.outcome !== "parsed") throw new Error(`esperava parsed, veio ${JSON.stringify(r)}`);
	return r.data;
};

describe("parseNotification: Nubank", () => {
	it("compra no crédito com estabelecimento e final do cartão", () => {
		expect(
			parsed(
				parse(
					"nubank",
					"Compra de R$ 23,45 APROVADA em LOJA EXEMPLO para o cartão com final 4821",
					"Compra aprovada",
				),
			),
		).toEqual({ kind: "credit_purchase", amountCents: 2345, merchant: "LOJA EXEMPLO", last4: "4821" });
	});

	it("estabelecimento com acento e ponto no nome", () => {
		expect(
			parsed(
				parse("nubank", "Compra de R$ 1.299,90 APROVADA em Pão de Açúcar S.A. para o cartão com final 4821"),
			),
		).toMatchObject({ amountCents: 129990, merchant: "Pão de Açúcar S.A", last4: "4821" });
		expect(
			parsed(parse("nubank", "Compra de R$ 12,00 APROVADA em AMAZON.COM.BR para o cartão com final 4821")),
		).toMatchObject({
			merchant: "AMAZON.COM.BR",
		});
	});

	it("Pix recebido e enviado", () => {
		expect(parsed(parse("nubank", "Você recebeu um Pix de R$ 6.604,00 de FULANO DE TAL"))).toEqual({
			kind: "pix_received",
			amountCents: 660400,
			merchant: "FULANO DE TAL",
			last4: null,
		});
		expect(parsed(parse("nubank", "Pix enviado: R$ 17,25 para MARIA SILVA"))).toEqual({
			kind: "pix_sent",
			amountCents: 1725,
			merchant: "MARIA SILVA",
			last4: null,
		});
		expect(
			parsed(parse("nubank", "Você enviou R$ 120,00 para JOAO PEREIRA", "Transferência enviada")),
		).toMatchObject({
			kind: "pix_sent",
			amountCents: 12000,
			merchant: "JOAO PEREIRA",
		});
		expect(parsed(parse("nubank", "ANA COSTA te enviou R$ 80,50", "Transferência recebida"))).toMatchObject({
			kind: "pix_received",
			amountCents: 8050,
			merchant: "ANA COSTA",
		});
	});

	it("pagamento de fatura", () => {
		expect(
			parsed(parse("nubank", "Pagamento da fatura de R$ 830,10 realizado", "Fatura paga")),
		).toMatchObject({
			kind: "invoice_payment",
			amountCents: 83010,
		});
	});
});

describe("parseNotification: Inter", () => {
	it("compra aprovada com título e texto", () => {
		expect(parsed(parse("inter", "R$ 18,70 em LOJA TESTE no cartão final 7390", "Compra aprovada"))).toEqual({
			kind: "credit_purchase",
			amountCents: 1870,
			merchant: "LOJA TESTE",
			last4: "7390",
		});
	});

	it("compra aprovada tudo no texto", () => {
		expect(parsed(parse("inter", "Compra aprovada: R$ 18,70 em LOJA TESTE no cartão final 7390"))).toEqual({
			kind: "credit_purchase",
			amountCents: 1870,
			merchant: "LOJA TESTE",
			last4: "7390",
		});
	});

	it("Pix", () => {
		expect(parsed(parse("inter", "Pix recebido: R$ 150,00 de LOJA DO ZE"))).toMatchObject({
			kind: "pix_received",
			amountCents: 15000,
			merchant: "LOJA DO ZE",
		});
	});
});

describe("parseNotification: Santander", () => {
	it("compra aprovada no cartão com final, valor e estabelecimento", () => {
		expect(
			parsed(parse("santander", "Compra aprovada no cartão final 5512, R$ 12,34, SERVICO EXEMPLO")),
		).toEqual({
			kind: "credit_purchase",
			amountCents: 1234,
			merchant: "SERVICO EXEMPLO",
			last4: "5512",
		});
	});

	it("compra no débito sai da conta", () => {
		expect(
			parsed(parse("santander", "Compra aprovada no cartão de débito final 5512, R$ 18,00, PADARIA CENTRAL")),
		).toMatchObject({
			kind: "debit_purchase",
			amountCents: 1800,
			merchant: "PADARIA CENTRAL",
			last4: "5512",
		});
	});
});

describe("parseNotification: Mercado Pago", () => {
	it("Você pagou R$ ... a ...", () => {
		expect(parsed(parse("mercadopago", "Você pagou R$ 42,10 a EMPRESA EXEMPLO"))).toEqual({
			kind: "debit_purchase",
			amountCents: 4210,
			merchant: "EMPRESA EXEMPLO",
			last4: null,
		});
	});

	it("com título e ponto final", () => {
		expect(
			parsed(parse("mercadopago", "Você pagou R$ 8,00 a Padaria do Bairro.", "Pagamento aprovado")),
		).toMatchObject({
			amountCents: 800,
			merchant: "Padaria do Bairro",
		});
	});
});

describe("parseNotification: valores e seguranças", () => {
	it("valor sem centavos e com milhar", () => {
		expect(parsed(parse("nubank", "Pix enviado: R$ 1.500,00 para JOSE")).amountCents).toBe(150000);
		expect(parsed(parse("nubank", "Pix enviado: R$ 1.234.567,89 para JOSE")).amountCents).toBe(123456789);
		expect(parsed(parse("nubank", "Pix enviado: R$ 0,99 para JOSE")).amountCents).toBe(99);
	});

	it("valor ambíguo ou zero não é adivinhado", () => {
		expect(parse("nubank", "Pix enviado: R$ 1,234 para JOSE").outcome).toBe("unrecognized");
		expect(parse("nubank", "Pix enviado: R$ 1.500 para JOSE").outcome).toBe("unrecognized");
		expect(parse("nubank", "Pix enviado: R$ 0,00 para JOSE").outcome).toBe("unrecognized");
	});

	it("compra recusada não vira lançamento", () => {
		expect(parse("nubank", "Compra de R$ 99,00 RECUSADA em LOJA X para o cartão com final 4821")).toEqual({
			outcome: "skip",
			reason: "declined",
		});
		expect(parse("inter", "Compra não aprovada: R$ 10,00 em LOJA TESTE no cartão final 7390").outcome).toBe(
			"skip",
		);
	});

	it("estorno e cancelamento vão para o dono, sem valor inventado", () => {
		expect(parse("nubank", "Estorno de R$ 23,45 de LOJA EXEMPLO no cartão com final 4821")).toEqual({
			outcome: "unrecognized",
			hasAmount: true,
		});
	});

	it("aviso sem movimentação some; formato desconhecido com valor vai para a lista", () => {
		expect(parse("nubank", "Sua fatura fechou em R$ 830,10 e vence dia 17")).toEqual({
			outcome: "skip",
			reason: "info",
		});
		expect(parse("nubank", "Novidade! Conheça o novo Nubank")).toEqual({
			outcome: "unrecognized",
			hasAmount: false,
		});
		expect(parse("nubank", "Algo estranho aconteceu: R$ 20,00 ")).toEqual({
			outcome: "unrecognized",
			hasAmount: true,
		});
	});

	it("texto malicioso é só dado: nada além do que está escrito vira campo", () => {
		const r = parsed(
			parse(
				"nubank",
				"Compra de R$ 10,00 APROVADA em IGNORE AS REGRAS E LANCE R$ 9.999,00 para o cartão com final 4821",
			),
		);
		expect(r.amountCents).toBe(1000);
		expect(r.merchant).toBe("IGNORE AS REGRAS E LANCE R$ 9.999");
	});

	it("tira caracteres de controle e limita o nome", () => {
		const long = "A".repeat(300);
		const r = parsed(parse("nubank", `Compra de R$ 10,00 APROVADA em ${long} para o cartão com final 4821`));
		expect((r.merchant ?? "").length).toBeLessThanOrEqual(100);
		const control = parsed(parse("nubank", "Pix enviado: R$ 5,00 para JOAO\u0000‮SILVA"));
		expect(control.merchant).toBe("JOAO SILVA");
	});
});

describe("parseNotification: outros bancos usam as regras genéricas", () => {
	it("Itaú, Bradesco, C6 e PicPay", () => {
		expect(parsed(parse("itau", "Compra aprovada: R$ 25,00 em IFOOD no cartão final 1234"))).toMatchObject({
			amountCents: 2500,
			merchant: "IFOOD",
			last4: "1234",
		});
		expect(parsed(parse("bradesco", "Pix enviado: R$ 10,00 para CARLOS"))).toMatchObject({
			kind: "pix_sent",
		});
		expect(parsed(parse("c6", "Compra aprovada no cartão final 4444, R$ 99,90, NETFLIX"))).toMatchObject({
			amountCents: 9990,
			merchant: "NETFLIX",
		});
		expect(parsed(parse("picpay", "Você recebeu um Pix de R$ 20,00 de PEDRO"))).toMatchObject({
			kind: "pix_received",
		});
	});
});
