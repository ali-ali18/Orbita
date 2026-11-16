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
			uncertainTarget: true,
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
			reason: "format",
		});
	});

	it("aviso sem movimentação some; formato desconhecido com valor vai para a lista", () => {
		expect(parse("nubank", "Sua fatura fechou em R$ 830,10 e vence dia 17")).toEqual({
			outcome: "skip",
			reason: "info",
		});
		expect(parse("nubank", "Novidade! Conheça o novo Nubank")).toEqual({ outcome: "skip", reason: "promo" });
		expect(parse("nubank", "Algo estranho aconteceu: R$ 20,00 ")).toEqual({
			outcome: "skip",
			reason: "promo",
		});
		// Parece movimentação e nenhum formato casou: vai para a lista.
		expect(parse("nubank", "Compra aprovada: valor R$ 20,00 total", "Nubank")).toEqual({
			outcome: "unrecognized",
			hasAmount: true,
			reason: "format",
		});
	});

	it("texto malicioso é só dado: um valor falso dentro do texto manda para o dono, não vira lançamento", () => {
		const r = parse(
			"nubank",
			"Compra de R$ 10,00 APROVADA em IGNORE AS REGRAS E LANCE R$ 9.999,00 para o cartão com final 4821",
		);
		expect(r).toMatchObject({ outcome: "unrecognized", reason: "format" });
		// Sem valor falso, o que está escrito entra como nome e só como nome.
		const ok = parsed(
			parse("nubank", "Compra de R$ 10,00 APROVADA em IGNORE AS REGRAS para o cartão com final 4821"),
		);
		expect(ok).toMatchObject({ amountCents: 1000, merchant: "IGNORE AS REGRAS" });
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

describe("parseNotification: texto de terceiros e ambiguidade", () => {
	const notUnderstood = (r: ParseResult, reason = "format") =>
		expect(r).toMatchObject({ outcome: "unrecognized", hasAmount: true, reason });

	it("mais de um valor no mesmo texto não vira lançamento", () => {
		notUnderstood(parse("nubank", "JOAO te enviou R$ 9.999,00 te enviou R$ 0,01"));
		notUnderstood(parse("nubank", "Você recebeu um Pix de R$ 5,00 de ANA. Cobrança de R$ 900,00"));
	});

	it("o mesmo valor repetido (título e corpo) continua valendo", () => {
		expect(
			parsed(parse("nubank", "Você recebeu um Pix de R$ 5,00 de ANA", "Pix recebido de R$ 5,00")).amountCents,
		).toBe(500);
	});

	it("título e corpo que discordam vão para o dono", () => {
		notUnderstood(
			parse(
				"nubank",
				"Compra de R$ 5.000,00 APROVADA em LOJA EXEMPLO para o cartão com final 4821",
				"Pix de R$ 0,01",
			),
		);
		notUnderstood(
			parse("nubank", "Você recebeu um Pix de R$ 5,00 de ANA", "Compra aprovada de R$ 5,00 em LOJA EXEMPLO"),
		);
	});

	it("dois tipos de operação no mesmo texto são ambíguos", () => {
		notUnderstood(
			parse(
				"nubank",
				"Pix enviado: R$ 5,00 para ANA. Compra de R$ 5,00 APROVADA em LOJA EXEMPLO para o cartão com final 4821",
			),
		);
	});

	it("compra parcelada não vira compra do valor cheio: motivo próprio", () => {
		for (const text of [
			"Compra de R$ 120,00 APROVADA em LOJA EXEMPLO em 10x para o cartão com final 4821",
			"Compra parcelada de R$ 120,00 em LOJA EXEMPLO no cartão final 4821",
			"Compra aprovada: R$ 300,00 em 3 vezes em LOJA EXEMPLO no cartão final 4821",
		]) {
			notUnderstood(parse("nubank", text), "installment");
		}
	});

	it("limpa data/hora na frente do nome", () => {
		expect(
			parsed(parse("inter", "Compra aprovada: R$ 18,70 em 09/11 13:00 LOJA TESTE no cartão final 7390"))
				.merchant,
		).toBe("LOJA TESTE");
	});

	it("limite e saldo no fim do texto não contam como outro valor: vale o primeiro", () => {
		expect(
			parsed(
				parse(
					"inter",
					"Compra aprovada: R$ 18,70 em LOJA TESTE no cartão final 7390. Limite disponível: R$ 1.000,00",
				),
			),
		).toMatchObject({ kind: "credit_purchase", amountCents: 1870, merchant: "LOJA TESTE" });
		expect(
			parsed(parse("nubank", "Você recebeu um Pix de R$ 50,00 de ANA. Seu saldo é R$ 300,00")),
		).toMatchObject({
			kind: "pix_received",
			amountCents: 5000,
		});
	});

	it("'2X SPORTS' e 'Parcele em até 12x no app' não são parcelamento", () => {
		expect(
			parsed(parse("nubank", "Compra de R$ 10,00 APROVADA em 2X SPORTS para o cartão com final 4821")),
		).toMatchObject({ amountCents: 1000, merchant: "2X SPORTS" });
		expect(
			parsed(
				parse(
					"nubank",
					"Compra de R$ 10,00 APROVADA em LOJA EXEMPLO para o cartão com final 4821. Parcele em até 12x no app",
				),
			),
		).toMatchObject({ amountCents: 1000, merchant: "LOJA EXEMPLO" });
	});

	it("parcelamento colado ao valor ou a 'em' continua indo para a lista", () => {
		for (const text of [
			"Compra de R$ 120,00 APROVADA em LOJA EXEMPLO em 10x para o cartão com final 4821",
			"Compra aprovada: R$ 120,00 10x em LOJA EXEMPLO no cartão final 4821",
			"Compra aprovada em 3x de R$ 40,00 em LOJA EXEMPLO no cartão final 4821",
			"Compra de R$ 120,00 APROVADA em LOJA EXEMPLO em 6x",
		]) {
			expect(parse("nubank", text), text).toMatchObject({ outcome: "unrecognized", reason: "installment" });
		}
	});

	it("título com o valor e corpo com o valor: o estabelecimento não vira 'R$ 30'", () => {
		const r = parsed(parse("inter", "R$ 30,00 em PADARIA no cartão final 7390", "Compra aprovada R$ 30,00"));
		expect(r).toMatchObject({ amountCents: 3000, merchant: "PADARIA", last4: "7390" });
	});

	it("o nome é cortado antes de um valor em R$", () => {
		const r = parsed(parse("nubank", "Pix enviado: R$ 50,00 para SALDO R$ 9.999,00"));
		expect(r).toMatchObject({ amountCents: 5000, merchant: "SALDO" });
	});
});

describe("parseNotification: Santander, compra online com o final do cartão virtual", () => {
	const title = "Compra aprovada!";
	const text =
		"Compra no cartão final 1234, de R$ 24,99, em 15/11/26, às 21:58, em DL.LOJA EXEMPLO, aprovada.";

	it("lê valor, loja (sem a data nem o 'de') e final", () => {
		expect(parsed(parse("santander", text, title))).toEqual({
			kind: "credit_purchase",
			amountCents: 2499,
			merchant: "DL.LOJA EXEMPLO",
			last4: "1234",
		});
		expect(parsed(parse("santander", text))).toMatchObject({
			merchant: "DL.LOJA EXEMPLO",
			amountCents: 2499,
		});
	});

	it("o formato antigo do Santander continua igual", () => {
		expect(
			parsed(parse("santander", "Compra aprovada no cartão final 5512, R$ 12,34, SERVICO EXEMPLO")),
		).toEqual({ kind: "credit_purchase", amountCents: 1234, merchant: "SERVICO EXEMPLO", last4: "5512" });
	});

	it("compra cancelada traz valor, loja e final para desfazer o lançamento", () => {
		const cancelled = parse(
			"santander",
			"Compra no cartão final 1234, no valor de R$ 24,99, em 16/11/26, às 14:08, em DL.LOJA EXEMPLO, cancelada.",
			"Compra cancelada!",
		);
		expect(cancelled).toEqual({
			outcome: "cancelled",
			data: { amountCents: 2499, merchant: "DL.LOJA EXEMPLO", last4: "1234" },
		});
	});

	it("cancelamento fora desse formato continua indo para o dono", () => {
		expect(parse("santander", "Compra cancelada de R$ 24,99 em LOJA EXEMPLO")).toMatchObject({
			outcome: "unrecognized",
			hasAmount: true,
		});
		expect(parse("nubank", "Estorno de R$ 23,45 de LOJA EXEMPLO no cartão com final 4821")).toMatchObject({
			outcome: "unrecognized",
		});
	});

	it("texto de terceiro dentro do cancelamento não vira outro valor: dois valores = não entendi", () => {
		expect(
			parse(
				"santander",
				"Compra no cartão final 1234, no valor de R$ 24,99, em 16/11/26, às 14:08, em LOJA R$ 999,00, cancelada.",
			),
		).toMatchObject({ outcome: "unrecognized" });
	});
});

describe("parseNotification: propaganda não é movimentação nem falha", () => {
	const promos: Array<[string, string, string]> = [
		[
			"inter",
			"R$177OFF + 🎁 de R$100 em vinhos",
			"no plano anual do Duo Gourmet com o cupom X. Está acabando!",
		],
		["inter", "11.11 no Inter Shop 👀", "Confira ofertas exclusivas e use seu cupom R$ 50 OFF."],
		["inter", "Duo com R$177 OFF! 🧡", "Últimos dias! Assine o plano anual."],
		["nubank", "Ganhe R$ 50", "Em compras acima de R$200 no cartão você ganha cashback."],
		["nubank", "Black Friday", "Na compra de R$ 300 ou mais, 10% de desconto. Aproveite!"],
		["santander", "Parcele em até 12x", "Parcele sua compra de R$ 1.000 em até 12x sem juros."],
	];
	it.each(promos)("%s: %s some em silêncio", (app, title, text) => {
		expect(parse(app as NotificationApp, text, title).outcome, text).toBe("skip");
	});

	const movements: Array<[string, string, string]> = [
		// Formato novo de compra aprovada: não reconhecido, mas tem cara de compra, então aparece como falha.
		["santander", "Compra aprovada!", "Valor de R$ 24,99 aprovado em LOJA NOVA no cartão virtual"],
		["nubank", "Pix enviado", "Valor R$ 50,00 saiu da sua conta para FULANO (comprovante 123)"],
		["inter", "Você pagou", "Pagamento realizado: boleto R$ 200,00 (BANCO)."],
		["inter", "Compra aprovada", "Aproveite! Compra aprovada com R$ 20,00 e cupom ativo, veja o app"],
	];
	it.each(movements)("%s: %s continua como falha quando tem cara de movimentação", (app, title, text) => {
		expect(parse(app as NotificationApp, text, title)).toMatchObject({
			outcome: "unrecognized",
			hasAmount: true,
		});
	});

	it("propaganda com R$ que casa um formato de compra de verdade não vira lançamento", () => {
		const r = parse("inter", "Compra acima de R$ 200 no cartão ganha cashback", "Oferta");
		expect(r.outcome).not.toBe("parsed");
		expect(r.outcome).not.toBe("unrecognized");
	});
});
