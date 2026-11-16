export interface C {
	app: string;
	title: string;
	text: string;
}
const apps = [
	"nubank",
	"inter",
	"santander",
	"itau",
	"bradesco",
	"bb",
	"caixa",
	"c6",
	"mercadopago",
	"picpay",
] as const;
const out: C[] = [];
const add = (app: string, title: string, text: string) => out.push({ app, title, text });
const stores = [
	"PADARIA SOL",
	"UBER *TRIP",
	"IFOOD *RESTAURANTE",
	"MERCADO LIVRE",
	"AMAZON PRIME",
	"POSTO IPIRANGA",
	"2X SPORTS",
	"OFF PREMIUM",
	"PLANO DE SAUDE UNIMED",
	"CUPOM FISCAL LTDA",
	"OFERTA DO DIA LOJAS",
	"PROMO BAR",
	"CASHBACK CAFE",
	"GANHE TUDO LTDA",
	"DESCONTO FACIL",
	"LOJA 50% OFF",
	"SUPERMERCADO 10% BARATO",
	"🎁 PRESENTES LTDA",
	"🔥 CHURRASCARIA",
	"CONFIRA OTICA",
	"APROVEITE VIAGENS",
	"FARMACIA POUPE 20%",
	"PLANO FIT ACADEMIA",
	"MP*OFERTAS",
	"NETFLIX.COM",
	"SPOTIFY",
	"99 TAXI",
	"RAPPI",
	"SHELL BOX",
	"DROGASIL",
];
const vals = ["12,34", "1.234,56", "0,99", "150,00", "2.500,00", "10.000,00", "45", "1.000"];
let i = 0;
for (const app of apps) {
	for (const s of stores) {
		const v = vals[i++ % vals.length];
		add(app, "", `Compra de R$ ${v} APROVADA em ${s} para o cartão com final 4821`);
		add(app, "Compra aprovada", `R$ ${v} em ${s} no cartão final 4821`);
		add(app, "", `Compra aprovada: R$ ${v} em ${s} no cartão final 7390`);
		add(app, "Compra no débito", `Compra no débito de R$ ${v} em ${s}`);
		add(app, "", `Compra no cartão final 1234, de R$ ${v}, em 15/11/26, às 21:58, em ${s}, aprovada.`);
		add(app, "Compra aprovada", `Compra aprovada no cartão final 5512, R$ ${v}, ${s}`);
		add(app, "", `Você pagou R$ ${v} a ${s}`);
		add(app, `Compra aprovada R$ ${v}`, `${s} - cartão final 1111`);
		add(app, "Compra aprovada", `R$ ${v} em ${s}`);
		add(app, "Compra realizada", `Compra realizada em ${s}, R$ ${v}`);
	}
}
for (const app of apps) {
	for (const v of vals) {
		add(app, "", `Você recebeu um Pix de R$ ${v} de MARIA SILVA`);
		add(app, "Pix recebido", `Pix recebido: R$ ${v} de JOAO`);
		add(app, "", `Pix enviado: R$ ${v} para CARLOS`);
		add(app, "Pix enviado", `Você enviou um Pix de R$ ${v} para ANA`);
		add(app, "", `Transferência enviada: R$ ${v} para PEDRO`);
		add(app, "", `Você recebeu uma transferência de R$ ${v} de EMPRESA LTDA`);
		add(app, "TED recebida", `TED de R$ ${v} recebida de EMPRESA SA`);
		add(app, "TED enviada", `Você enviou uma TED de R$ ${v} para FULANO`);
		add(app, "Boleto pago", `Pagamento de boleto no valor de R$ ${v} realizado com sucesso`);
		add(app, "Boleto", `Seu boleto de R$ ${v} foi pago`);
		add(app, "Débito automático", `Débito automático de R$ ${v} - ENERGIA`);
		add(app, "Débito automático", `Débito automático realizado: R$ ${v} CLARO`);
		add(app, "Pagamento de fatura", `Pagamento de fatura de R$ ${v} confirmado`);
		add(app, "", `Você pagou a fatura de R$ ${v}`);
		add(app, "Fatura", `Sua fatura de R$ ${v} foi paga`);
		add(app, "Fatura fechada", `Sua fatura fechou em R$ ${v}. Vence dia 10`);
		add(app, "Saque", `Saque de R$ ${v} realizado no caixa eletrônico`);
		add(app, "Saque", `Você sacou R$ ${v}`);
		add(app, "Estorno", `Estorno de R$ ${v} em LOJA X`);
		add(app, "Estorno", `Estorno recebido: R$ ${v}`);
		add(app, "Salário", `Seu salário de R$ ${v} foi creditado`);
		add(app, "Salário", `Salário recebido: R$ ${v}`);
		add(app, "Depósito", `Depósito de R$ ${v} recebido`);
		add(app, "Limite", `Seu limite foi aumentado para R$ ${v}`);
		add(app, "Compra parcelada", `Compra de R$ ${v} em 3x em LOJA PARCELA`);
		add(app, "", `Compra aprovada R$ ${v} em 10x em MAGALU`);
		add(app, "", `Cobrança de R$ ${v} - ASSINATURA`);
		add(app, "Pix agendado", `Pix agendado de R$ ${v} para ZE`);
		add(app, "Compra no débito", `Compra no débito aprovada: R$ ${v} em BAR DO ZE`);
		add(app, "Pix", `Pix recebido de MARIA R$ ${v}`);
		add(app, `Maria te enviou R$ ${v}`, "");
		add(app, "", `MARIA te enviou um Pix de R$ ${v}`);
		add(
			app,
			"Compra cancelada!",
			`Compra no cartão final 1234, no valor de R$ ${v}, em 16/11/26, às 14:08, em LOJA EXEMPLO, cancelada.`,
		);
		add(app, "Compra cancelada", `Compra de R$ ${v} em LOJA EXEMPLO foi cancelada`);
		add(app, "Compra recusada", `Compra recusada de R$ ${v}`);
	}
}
// Ofertas
const offers = [
	"Cupom de R$ 20 de desconto no iFood! Aproveite",
	"Ganhe R$ 50 de cashback na primeira compra",
	"Aproveite: R$ 100 OFF em compras acima de R$ 300",
	"Black Friday! Parcele em até 12x e ganhe R$ 50 de volta",
	"Convide um amigo e ganhe R$ 30",
	"Limite pré-aprovado de R$ 5.000 para você",
	"Seu empréstimo de até R$ 10.000 está liberado. Confira!",
	"Oferta imperdível: cartão sem anuidade, ganhe R$ 100",
	"Receba R$ 50 de volta em compras no supermercado",
	"Assine o plano por R$ 9,90 por mês",
	"🎁 Presente pra você: R$ 15 de desconto",
	"Compre com 20% OFF e pague R$ 80",
	"Invista R$ 100 e ganhe bônus",
	"Sorteio: concorra a R$ 10.000",
	"Pague sua conta de luz por R$ 0,00 de tarifa",
	"Pix parcelado: compre agora em até 10x de R$ 50",
	"Seu cashback de R$ 12,50 já está disponível",
	"Você ganhou R$ 5 de cashback",
	"Cashback de R$ 3,20 creditado na sua conta",
	"Desconto de R$ 10 liberado para você",
	"Promoção: compre R$ 100 e leve R$ 150",
	"Receba até R$ 200 ao indicar um amigo",
	"Aproveite R$ 10 de desconto no Pix de hoje",
	"Cupom de R$ 7 aplicado. Pagamento aprovado em PADARIA R$ 23,00",
	"Pagamento de R$ 50 aprovado: ganhe cupom de desconto",
];
for (const app of apps)
	for (const o of offers) {
		add(app, "", o);
		add(app, "Oferta", o);
	}
// Cancel / tricky
add(
	"santander",
	"Compra cancelada!",
	"Compra no cartão final 1234, no valor de R$ 24,99, em 16/11/26, às 14:08, em LOJA EXEMPLO, cancelada.",
);
add(
	"santander",
	"Compra cancelada!",
	"Compra no cartão final 1234, no valor de R$ 24,99, em 16/11/26, às 14:08, em OFERTA LOJA, cancelada.",
);
add(
	"santander",
	"",
	"Compra no cartão final 1234, de R$ 24,99, em 15/11/26, às 21:58, em CUPOM LTDA, aprovada.",
);
add(
	"santander",
	"",
	"Compra no cartão final 1234, de R$ 24,99, em 15/11/26, às 21:58, em DESCONTO TOTAL, aprovada.",
);
add(
	"santander",
	"",
	"Compra no cartão final 1234, de R$ 24,99, em 15/11/26, às 21:58, em GANHE E CUPOM OFERTA, aprovada.",
);
add("nubank", "", "Compra de R$ 30,00 APROVADA em CASHBACK E OFERTAS para o cartão com final 4821");
add("nubank", "", "Compra de R$ 30,00 em PROMOCAO LTDA para o cartão com final 4821");
add("nubank", "", "Compra de R$ 30,00 em OFERTA 10 LTDA para o cartão com final 4821");
add("nubank", "", "Compra de R$ 30,00 em CUPOM DESCONTO para o cartão com final 4821");
add("nubank", "", "Compra de R$ 30,00 em GANHE MAIS para o cartão com final 4821");
add("inter", "Compra aprovada", "R$ 30,00 em PROMO 50% OFF no cartão final 7390");
add("inter", "Pix enviado", "Pix enviado: R$ 30,00 para DESCONTO LTDA");
add("inter", "Pix recebido", "Pix recebido: R$ 30,00 de CUPOM LTDA");
add("itau", "", "Pix enviado: R$ 30,00 para OFERTAS COMERCIO");
add("bb", "", "Você recebeu um Pix de R$ 100,00 de GANHE IMOVEIS");
add("bb", "Pix", "Você recebeu um Pix de R$ 100,00 de PROMOCAO LTDA e CUPOM SA");
add("c6", "Pagamento", "Pagamento de R$ 80,00 para CUPOM FISCAL");
add("caixa", "Boleto", "Boleto de R$ 80,00 pago. Aproveite o desconto no próximo!");
add("bradesco", "", "Compra aprovada R$ 80,00 em LOJA. Aproveite: cupom de R$ 10 de desconto");
add("bradesco", "", "Compra aprovada em LOJA, R$ 80,00. Ganhe cashback!");
add("nubank", "", "Você pagou R$ 80,00 a CUPOM DESCONTO");
add("picpay", "Você pagou R$ 80,00", "para OFERTA DO DIA");
add("mercadopago", "Você pagou R$ 80,00", "a CONFIRA ÓTICA");
add("nubank", "Compra aprovada", "Compra de R$ 30,00 aprovada em LOJA. Aproveite 10% de cashback");
add("nubank", "", "Compra de R$ 30,00 em LOJA aprovada. Cupom de desconto disponível");
add("nubank", "", "Compra de R$ 99,00 em Netflix. Você ganhou desconto de R$ 10");
add("nubank", "", "Compra de R$ 99,00 em Netflix. Ganhe desconto e cupom");
add("itau", "Compra", "Compra de R$ 99,00 em PLANO SAUDE OFF");
add("itau", "", "Compra aprovada R$ 20,00 em 🔥 LOJA");
add("itau", "", "Compra de R$ 20,00 em LOJA 🎁");
add("c6", "", "Compra de R$ 99,00 em ACABANDO HOJE LTDA para o cartão com final 1234");
add("c6", "", "Compra de R$ 99,00 em ÚLTIMOS DIAS BAR para o cartão com final 1234");
add("c6", "", "Compra de R$ 99,00 em DE VOLTA PRA CASA para o cartão com final 1234");
add("c6", "", "Compra de R$ 99,00 em CONVIDE BAR para o cartão com final 1234");
add("c6", "", "Compra de R$ 99,00 em CONFIRA ÓTICA para o cartão com final 1234");
add("c6", "", "Compra de R$ 99,00 em RESGATE CAFE para o cartão com final 1234");
add("c6", "", "Compra de R$ 99,00 em INDIQUE E GANHE para o cartão com final 1234");
add("c6", "", "Compra de R$ 99,00 em A PARTIR DE BAR para o cartão com final 1234");
add("c6", "", "Compra de R$ 99,00 em ACIMA DE TUDO para o cartão com final 1234");
add("c6", "", "Compra de R$ 99,00 em SORTEIO BAR para o cartão com final 1234");
add("c6", "", "Compra de R$ 99,00 em FRETE GRATIS LTDA para o cartão com final 1234");
add("c6", "", "Compra de R$ 99,00 em BLACK FRIDAY STORE para o cartão com final 1234");
add("c6", "", "Compra de R$ 99,00 em IMPERDIVEL LTDA para o cartão com final 1234");
add("c6", "", "Compra de R$ 99,00 em PROMOCOES LTDA para o cartão com final 1234");
add("nubank", "", "Compra de R$ 99,00 em ATE 12X SHOP para o cartão com final 1234");
add("nubank", "Compra aprovada", "R$ 99,00 em CASHBACK STORE");
add("nubank", "", "Pix recebido: R$ 99,00 de CASHBACK SA");
add("nubank", "Pix recebido", "Você recebeu um Pix de R$ 99,00 de APROVEITE LTDA");
add("nubank", "", "Você recebeu um Pix de R$ 99,00 de OFERTAS E DESCONTO LTDA");
// títulos separados
add("nubank", "Compra aprovada", "Compra de R$ 99,00 em CUPOM BAR");
add("inter", "Cashback recebido", "Você recebeu R$ 3,00 de cashback");
add("inter", "Rendimento", "Seu dinheiro rendeu R$ 0,45 hoje");
add("nubank", "Rendimento", "Você ganhou R$ 0,45 de rendimento");
add("nubank", "Resgate", "Resgate de R$ 500,00 do seu cofrinho realizado");
add("nubank", "Cofrinho", "Você guardou R$ 100,00");
add("c6", "Investimento", "Aplicação de R$ 500,00 realizada com sucesso");
add("bb", "Pix", "Pix R$ 50,00 enviado para ZE");
add("itau", "Itaú", "Você fez um Pix de R$ 50,00 para ZE");
add("itau", "Cartão", "Compra aprovada no cartão final 4444 em LOJA R$ 99,90");
add("itau", "Cartão", "Compra aprovada LOJA R$ 99,90");
add("bradesco", "Bradesco", "Compra aprovada no cartão final 4444 valor R$ 99,90 local: LOJA");
add("caixa", "Caixa", "Compra no cartão de crédito final 4444 no valor de R$ 99,90 em LOJA");
add("bb", "BB", "Compra de R$ 99,90 no cartão final 4444 - LOJA");
add("mercadopago", "Mercado Pago", "Você pagou R$ 99,90 a LOJA com o cartão final 4444");
add("picpay", "PicPay", "Pagamento de R$ 99,90 aprovado em LOJA");
add("picpay", "PicPay", "Você pagou R$ 99,90 para LOJA");
add("picpay", "PicPay", "Você recebeu R$ 99,90 de FULANO");
add("mercadopago", "Mercado Pago", "Você recebeu R$ 99,90 de FULANO");
add("mercadopago", "Mercado Pago", "Você recebeu um pagamento de R$ 99,90");
add("mercadopago", "Mercado Pago", "Dinheiro disponível: R$ 99,90 liberado");
add("mercadopago", "Mercado Pago", "Pagamento aprovado de R$ 99,90");
add("nubank", "Nubank", "Transferência recebida de R$ 99,90 de FULANO");
add("nubank", "Nubank", "Você recebeu uma transferência de R$ 99,90");
add("nubank", "Nubank", "Você pagou o boleto de R$ 99,90");
add("nubank", "Nubank", "Boleto de R$ 99,90 vence amanhã");
add("nubank", "Nubank", "Pagamento de R$ 99,90 realizado");
add("nubank", "Nubank", "Pagamento recebido: R$ 99,90");
add("nubank", "Nubank", "Fatura paga: R$ 99,90");
add("nubank", "Nubank", "Sua fatura vence hoje: R$ 99,90");
add("nubank", "Nubank", "Parcelamos sua compra: 3x de R$ 33,30");
add("nubank", "Nubank", "Compra no crédito de R$ 99,90 em LOJA");
add("nubank", "Nubank", "Compra no débito de R$ 99,90 em LOJA");
add("nubank", "Nubank", "Compra de R$ 99,90 em LOJA aprovada");
add("nubank", "Nubank", "Valor de R$ 99,90 debitado da sua conta");
add("nubank", "Nubank", "Compra de R$ 99,90 realizada");
add("nubank", "Nubank", "Compra efetuada: R$ 99,90");
add("nubank", "Nubank", "Você fez uma compra de R$ 99,90");
add("inter", "Inter", "Débito de R$ 99,90 na sua conta");
add("inter", "Inter", "R$ 99,90 debitados");
add("inter", "Inter", "Lançamento de R$ 99,90 na conta");
add("inter", "Inter", "Cobrança de R$ 99,90 pendente");
add("inter", "Inter", "Parabéns! Você ganhou R$ 10 de bônus");
add("inter", "Inter", "Seu Pix de R$ 99,90 foi concluído");
add("inter", "Inter", "Sua compra de R$ 99,90 foi aprovada");
add("inter", "Inter", "Sua compra na LOJA de R$ 99,90 foi aprovada");
add("inter", "Inter", "Compra de R$ 99,90 aprovada! Ganhe cashback");
add("itau", "Itaú", "Aprovada compra de R$ 99,90 em LOJA");
add("itau", "Itaú", "Transação aprovada R$ 99,90 LOJA");
add("itau", "Itaú", "Transação de R$ 99,90 aprovada");
add("itau", "Itaú", "Saque de R$ 99,90 realizado");
add("itau", "Itaú", "Pagamento de conta de R$ 99,90 efetuado");
add("itau", "Itaú", "Pagamento de convênio R$ 99,90");
add("itau", "Itaú", "Compra com cartão de débito de R$ 99,90");
add("itau", "Itaú", "Você pagou R$ 99,90 de IPTU");
add("bb", "BB", "Transferência de R$ 99,90 realizada");
add("bb", "BB", "Pix de R$ 99,90 realizado");
add("bb", "BB", "Pix efetuado no valor de R$ 99,90");
add("bb", "BB", "Compra aprovada no valor de R$ 99,90");
add("bb", "BB", "Compra aprovada no valor de R$ 99,90 em LOJA");
add("bb", "BB", "Pagamento efetuado: R$ 99,90");
add("caixa", "Caixa", "Pix recebido no valor de R$ 99,90");
add("caixa", "Caixa", "Crédito de R$ 99,90 em sua conta");
add("caixa", "Caixa", "Benefício de R$ 600,00 disponível");
add("caixa", "Caixa", "FGTS: depósito de R$ 99,90");
add("c6", "C6", "Compra aprovada de R$ 99,90 em LOJA");
add("c6", "C6", "Compra aprovada no C6 Card final 1234 de R$ 99,90 em LOJA");
add("c6", "C6", "Pix recebido de R$ 99,90");
add("bradesco", "Bradesco", "Compra aprovada de R$ 99,90");
add("bradesco", "Bradesco", "Pix recebido R$ 99,90");
add("bradesco", "Bradesco", "Transferência recebida R$ 99,90");
add("santander", "Santander", "Compra aprovada de R$ 99,90 em LOJA");
add("santander", "Santander", "Pix enviado de R$ 99,90 para FULANO");
// emoji/odd
add("nubank", "", "💸 Pix enviado: R$ 20,00 para ZE");
add("nubank", "", "Pix enviado: R$ 20,00 para ZE 🔥");
add("nubank", "", "🎉 Compra aprovada: R$ 20,00 em BAR");
add("nubank", "", "Compra aprovada: R$ 20,00 em 🎁 BAR");
add("nubank", "", "Você recebeu um Pix de R$ 20,00 de 🔥 ZE");
add("nubank", "", "Compra de R$ 20,00 APROVADA em PADARIA 10% para o cartão com final 4821");
add("nubank", "", "Compra de R$ 20,00 APROVADA em 20% OFF para o cartão com final 4821");
add("nubank", "", "Compra de R$ 20,00 APROVADA em OFF para o cartão com final 4821");
add("nubank", "", "Pix enviado: R$ 20,00 para ZE OFF");
add("nubank", "", "Pix recebido: R$ 20,00 de PROMO TOP");
add("nubank", "", "Boleto 10% off pago R$ 20,00");
add("nubank", "", "Pagamento de boleto: R$ 20,00 com 10% de desconto");
add("nubank", "", "Boleto pago com desconto: R$ 20,00");
add("nubank", "", "Você pagou R$ 20,00 de boleto com desconto");
add("nubank", "", "Salário de R$ 5.000,00 recebido. Aproveite e invista!");
add("nubank", "", "Pix recebido R$ 5.000,00 de EMPRESA. Aproveite!");
add("itau", "", "Seu pagamento de R$ 99,90 foi aprovado. Ganhe cupom");
add("itau", "", "Cobrança de R$ 99,90 - DESCONTO CLUBE");
add("itau", "", "Débito de R$ 99,90 - CASHBACK CLUBE");
add("itau", "", "Pagamento de R$ 99,90 a OFERTAS LTDA");
add("itau", "", "Pagamento de R$ 99,90 - PROMO");
add("itau", "", "Fatura do cartão de R$ 99,90 com desconto");
add("itau", "", "Fatura de R$ 99,90 paga! Ganhe cashback");
add("itau", "", "Pagamento de fatura de R$ 99,90 realizado. Ganhe pontos");
add("itau", "", "Pagamento da fatura de R$ 99,90 confirmado");
add("itau", "", "Estorno de R$ 99,90 - oferta");
add("itau", "", "Estorno de R$ 99,90 da LOJA PROMO");
add("itau", "", "Saque de R$ 99,90 - PROMO");
add("bb", "", "Mensalidade de R$ 99,90 - PLANO OFF");
add("bb", "", "Mensalidade de R$ 99,90 debitada");
add("bb", "", "Mensalidade R$ 99,90 PLANO");
// multi-valor
add("nubank", "", "Compra de R$ 99,90 em LOJA. Limite disponível: R$ 1.000,00");
add("nubank", "", "Compra de R$ 99,90 em LOJA. Saldo R$ 100,00");
add("nubank", "", "Compra de R$ 99,90 em LOJA. Cupom de R$ 10 liberado");
add("nubank", "", "Pix recebido de R$ 99,90 de ZE. Seu saldo é R$ 1.000");
add("nubank", "", "Pix recebido de R$ 99,90 de ZE. Ganhe R$ 10");
// no accent ASCII
add("nubank", "", "Compra de R$ 25,00 APROVADA em LOJA SEM ACENTO para o cartao com final 1111");
// no space
add("nubank", "", "Compra de R$25,00 APROVADA em LOJA para o cartão com final 1111");
add("nubank", "", "Compra de R$25 aprovada em LOJA");
// multiline
add("nubank", "Compra aprovada", "Compra de R$ 25,00\nem LOJA\ncartão final 1111");
add("nubank", "Compra aprovada", "Valor: R$ 25,00\nLocal: LOJA\nCartão final 1111");
add("nubank", "Compra aprovada", "Local: LOJA\nValor R$ 25,00");
add("nubank", "Compra aprovada", "Estabelecimento: LOJA Valor: R$ 25,00");
add("inter", "", "Fatura de R$ 25,00 vence amanhã");
add("inter", "", "Limite de R$ 25,00 para Pix noturno");
add("inter", "", "Pagamento de boleto R$ 25,00 limite diário atingido");
add("inter", "", "Boleto de R$ 25,00 pago. Limite restante R$ 1.000");
export const corpus = out;
