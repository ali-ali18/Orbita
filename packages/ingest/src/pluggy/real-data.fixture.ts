import { type FakePluggyOptions, ITEM_ID } from "./fake-pluggy.ts";

/*
 * Respostas fake da Pluggy no formato do SDK, com o formato e os padrões vistos em 4 conexões MeuPluggy (Inter, Mercado
 * Pago, Santander, Nubank), todas com `connector.isOpenFinance = false`. Os dados são FICTÍCIOS (nomes, documentos,
 * finais de conta e valores inventados), mas mantêm as relações que os testes verificam: nome, valor, sinal, categoria,
 * `operationType` e `creditCardMetadata` como o conector os entrega.
 *
 * Convenção do Pluggy que o conector mostra: na CONTA o débito vem negativo; no CARTÃO a compra vem positiva e o
 * crédito (pagamento recebido, estorno) vem negativo.
 */

type Json = Record<string, unknown>;

export const REAL_NOW = new Date("2026-11-09T12:00:00Z");

export const ITEMS = {
	inter: ITEM_ID,
	mp: "22222222-2222-4222-8222-222222222222",
	santander: "33333333-3333-4333-8333-333333333333",
	nubank: "44444444-4444-4444-8444-444444444444",
} as const;

export const ACCOUNTS = {
	interBank: "a1000000-0000-4000-8000-000000000001",
	interSavings: "a1000000-0000-4000-8000-000000000002",
	interCard: "a1000000-0000-4000-8000-000000000003",
	mpBank: "a2000000-0000-4000-8000-000000000001",
	mpCard: "a2000000-0000-4000-8000-000000000002",
	santanderBank: "a3000000-0000-4000-8000-000000000001",
	santanderCard: "a3000000-0000-4000-8000-000000000002",
	nubankBank: "a4000000-0000-4000-8000-000000000001",
	nubankCard: "a4000000-0000-4000-8000-000000000002",
} as const;

const OWNER = "FULANO DE TAL";

const connector = (id: number) => ({
	id,
	name: "MeuPluggy",
	isSandbox: false,
	isOpenFinance: false,
	type: "PERSONAL_BANK",
});

const bankAccount = (
	id: string,
	itemId: string,
	name: string,
	number: string,
	balance: number,
	sub = "CHECKING_ACCOUNT",
) => ({
	id,
	type: "BANK",
	subtype: sub,
	name,
	marketingName: null,
	number,
	owner: OWNER,
	taxNumber: null,
	balance,
	currencyCode: "BRL",
	itemId,
	creditData: null,
});

const cardAccount = (
	id: string,
	itemId: string,
	name: string,
	number: string,
	balance: number,
	credit: { limit: number; available: number; minimum: number; brand: string; level: string },
) => ({
	id,
	type: "CREDIT",
	subtype: "CREDIT_CARD",
	name,
	marketingName: null,
	number,
	owner: OWNER,
	taxNumber: null,
	balance,
	currencyCode: "BRL",
	itemId,
	creditData: {
		level: credit.level,
		brand: credit.brand,
		balanceCloseDate: null,
		balanceDueDate: null,
		creditLimit: credit.limit,
		availableCreditLimit: credit.available,
		minimumPayment: credit.minimum,
	},
});

/** Lançamento de CONTA: valor com o sinal do diagnóstico (débito negativo). */
function acct(
	id: string,
	date: string,
	description: string,
	amount: number,
	category: string,
	operationType: string | null,
	extra: Json = {},
): Json {
	return {
		id,
		description,
		descriptionRaw: description,
		currencyCode: "BRL",
		amount,
		amountInAccountCurrency: null,
		date: `${date}T00:00:00.000Z`,
		category,
		categoryId: null,
		status: "POSTED",
		type: amount < 0 ? "DEBIT" : "CREDIT",
		operationType,
		providerId: null,
		providerCode: null,
		paymentData: null,
		creditCardMetadata: null,
		...extra,
	};
}

interface CardMeta {
	billId?: string;
	post?: string;
	forecast?: string;
	paymentType?: "SINGLE" | "INSTALLMENT";
	n?: number;
	of?: number;
	purchase?: string;
}

/** Lançamento de CARTÃO: compra positiva, crédito negativo. */
function card(
	id: string,
	date: string,
	description: string,
	amount: number,
	category: string,
	operationType: string | null,
	status: "POSTED" | "PENDING",
	meta: CardMeta = {},
	extra: Json = {},
): Json {
	return {
		id,
		description,
		descriptionRaw: description,
		currencyCode: "BRL",
		amount,
		amountInAccountCurrency: null,
		date: `${date}T00:00:00.000Z`,
		category,
		categoryId: null,
		status,
		type: amount < 0 ? "CREDIT" : "DEBIT",
		operationType,
		providerId: null,
		providerCode: null,
		paymentData: null,
		creditCardMetadata: {
			installmentNumber: meta.n ?? null,
			totalInstallments: meta.of ?? null,
			billId: meta.billId ?? null,
			totalAmount: null,
			payeeMCC: null,
			purchaseDate: meta.purchase ? `${meta.purchase}T00:00:00.000Z` : null,
			billPostDate: meta.post ? `${meta.post}T00:00:00.000Z` : null,
			billForecastDate: meta.forecast ?? null,
			paymentType: meta.paymentType ?? null,
		},
		...extra,
	};
}

const self = (doc = "123") => ({
	payer: { documentNumber: { value: doc }, name: OWNER },
	receiver: { documentNumber: { value: doc }, name: OWNER },
});

const bill = (
	id: string,
	due: string,
	close: string,
	total: number,
	minimum: number | null,
	payments: Array<[string, number]> = [],
) => ({
	id,
	dueDate: `${due}T00:00:00.000Z`,
	billClosingDate: `${close}T00:00:00.000Z`,
	totalAmount: total,
	totalAmountCurrencyCode: "BRL",
	minimumPaymentAmount: minimum,
	payments: payments.map(([date, amount], i) => ({
		id: `${id}-p${i}`,
		paymentDate: `${date}T00:00:00.000Z`,
		amount,
		currencyCode: "BRL",
	})),
});

// ------------------------------------------------------------------------------------------------ Inter

const interBank: Json[] = [
	acct("ib-01", "2026-11-07", "Pix enviado - Fulano de Tal", -342.32, "Same person transfer", "PIX", {
		paymentData: self(),
	}),
	acct("ib-02", "2026-11-06", "Pix enviado - Loja Digital Exemplo", -79.5, "Services", "PIX", {
		paymentData: {
			payer: null,
			receiver: { documentNumber: { value: "000" }, name: "LOJA DIGITAL EXEMPLO LTDA" },
		},
	}),
	acct(
		"ib-03",
		"2026-11-03",
		"Pagamento efetuado - Pagamento Fatura - FULANO DE TAL",
		-1383.88,
		"Transfers",
		"BOLETO",
		{
			paymentData: { payer: null, receiver: { documentNumber: { value: "000" }, name: "BANCO INTER S.A" } },
		},
	),
	acct("ib-04", "2026-11-03", "Débito B3 - Nota Bov 29/10/2026", -199.24, "Investments", "OUTROS"),
	acct("ib-05", "2026-10-31", "Pix recebido - Fulano de Tal", 1383.88, "Same person transfer", "PIX", {
		paymentData: self(),
	}),
	acct("ib-06", "2026-10-29", "Débito B3 - Nota Bov 27/10/2026", -141.22, "Investments", "OUTROS"),
	acct("ib-07", "2026-10-17", "Pix recebido - Fulano de Tal", 55.18, "Same person transfer", "PIX", {
		paymentData: self(),
	}),
	acct("ib-08", "2026-10-17", "Pix recebido - Fulano de Tal", 138.68, "Same person transfer", "PIX", {
		paymentData: self(),
	}),
	acct("ib-09", "2026-10-17", "Pix enviado - Loja Digital Exemplo", -286.48, "Services", "PIX"),
	acct("ib-10", "2026-10-16", "Pix enviado - Loja Digital Exemplo", -292.42, "Services", "PIX"),
	acct(
		"ib-11",
		"2026-10-11",
		"Pix enviado - Dlocal Brasil Instituicao De Pagamento S A",
		-59.8,
		"Services",
		"PIX",
	),
	acct("ib-12", "2026-10-10", "Pix enviado - Beltrano Silva", -20, "Transfer - PIX", "PIX", {
		paymentData: {
			payer: null,
			receiver: { documentNumber: { value: "456" }, name: "BELTRANO SILVA" },
		},
	}),
	acct("ib-13", "2026-10-10", "Compra no débito - Lanchonete Exemplo", -71.6, "Eating out", "OUTROS"),
	acct("ib-14", "2026-10-10", "Pix enviado - Loja Digital Exemplo", -769.06, "Services", "PIX"),
	acct("ib-15", "2026-10-10", "Resgate - Cdb Porq Obj Banco Inter S A", 8.06, "Investments", "OUTROS"),
];

const interCard: Json[] = [
	card("ic-01", "2026-11-08", "MLP KABUM-KABUM CIDADE BRA", 103, "Electronics", "PAGAMENTO", "PENDING", {
		post: "2026-11-08",
		forecast: "2026-11",
		paymentType: "INSTALLMENT",
		n: 5,
		of: 10,
		purchase: "2026-07-11",
	}),
	card("ic-02", "2026-11-03", "PAGAMENTO ON LINE", -1383.88, "Shopping", "PAGAMENTO", "POSTED", {
		billId: "bill-inter-a",
		post: "2026-11-03",
		forecast: "2026-11",
		paymentType: "SINGLE",
	}),
	card("ic-03", "2026-10-10", "iof internacional", 34.24, "Tax on financial operations", "TARIFA", "POSTED", {
		billId: "bill-inter-a",
		forecast: "2026-10",
	}),
	card("ic-04", "2026-10-09", "mlp kabum-kabum cidade bra", 103, "Electronics", "PAGAMENTO", "POSTED", {
		billId: "bill-inter-a",
		paymentType: "INSTALLMENT",
		n: 4,
		of: 10,
		purchase: "2026-07-11",
	}),
	card(
		"ic-05",
		"2026-10-08",
		"anthropic claude sub san francisco ca",
		978.36,
		"Transfers",
		"PAGAMENTO",
		"POSTED",
		{
			billId: "bill-inter-a",
			paymentType: "SINGLE",
		},
	),
	card("ic-06", "2026-10-07", "pagamento on line", -1051.14, "Shopping", "PAGAMENTO", "POSTED", {
		billId: "bill-inter-a",
	}),
	card(
		"ic-07",
		"2026-10-06",
		"kiwify curso exemplo bra",
		268.28,
		"School",
		"PAGAMENTO",
		"POSTED",
		{
			paymentType: "INSTALLMENT",
			n: 12,
			of: 12,
			purchase: "2025-11-06",
		},
		{ merchant: { name: "kiwify", businessName: null, cnae: null, category: null } },
	),
	card("ic-08", "2026-09-27", "pag steam cidade bra", 104.18, "Leisure", "PAGAMENTO", "POSTED", {
		billId: "bill-inter-b",
		paymentType: "INSTALLMENT",
		n: 3,
		of: 3,
		purchase: "2026-07-25",
	}),
	card("ic-09", "2026-09-27", "iof internacional", 7.7, "Tax on financial operations", "TARIFA", "POSTED"),
	card(
		"ic-10",
		"2026-09-25",
		"anthropic claude sub san francisco ca",
		220,
		"Transfers",
		"PAGAMENTO",
		"POSTED",
		{
			billId: "bill-inter-b",
		},
	),
];

const interBills = [
	bill("bill-inter-a", "2026-11-12", "2026-11-05", 0, 0),
	bill("bill-inter-b", "2026-10-12", "2026-10-05", 1051.14, 157.68, [["2026-11-03", 1383.88]]),
	bill("inter-0912", "2026-09-12", "2026-09-04", 635.14, 95.28, [["2026-09-08", 635.14]]),
	bill("inter-0812", "2026-08-12", "2026-08-05", 475.68, null, [["2026-08-10", 475.68]]),
	bill("inter-0712", "2026-07-12", "2026-07-05", 317.82, null, [["2026-07-10", 317.82]]),
	bill("inter-0612", "2026-06-12", "2026-06-05", 348.28, null, [["2026-06-11", 348.28]]),
	bill("inter-0512", "2026-05-12", "2026-05-05", 268.28, null, [["2026-05-06", 268.28]]),
	bill("inter-0412", "2026-04-12", "2026-04-05", 669.08, null, [["2026-04-08", 669.08]]),
	bill("inter-0312", "2026-03-12", "2026-03-05", 404.7, null, [["2026-03-09", 404.7]]),
	bill("inter-0212", "2026-02-12", "2026-02-05", 469, null, [["2026-02-06", 469]]),
	bill("inter-0112", "2026-01-12", "2026-01-05", 0, null),
	bill("inter-1212", "2025-12-12", "2025-12-05", 268.28, null, [["2026-01-03", 404.72]]),
	bill("inter-1112", "2025-11-12", "2025-11-05", 379.92, null, [["2025-11-07", 379.92]]),
];

// ---------------------------------------------------------------------------------------- Mercado Pago

const mpBank: Json[] = [
	acct(
		"mb-01",
		"2026-11-07",
		"Pagamento de fatura Cartão de crédito",
		-296.76,
		"Transfers",
		"OPERACAO_CREDITO",
	),
	acct("mb-02", "2026-11-07", "Pix recebido FULANO DE TAL", 67.26, "Same person transfer", "PIX", {
		paymentData: self(),
	}),
	acct("mb-03", "2026-11-07", "Pix recebido FULANO DE TAL", 342.32, "Same person transfer", "PIX", {
		paymentData: self(),
	}),
	acct(
		"mb-04",
		"2026-11-06",
		"Rendimentos",
		0.06,
		"Proceeds interests and dividends",
		"RESGATE_APLIC_FINANCEIRA",
	),
	acct(
		"mb-05",
		"2026-11-05",
		"Rendimentos",
		0.06,
		"Proceeds interests and dividends",
		"RESGATE_APLIC_FINANCEIRA",
	),
	acct(
		"mb-06",
		"2026-11-04",
		"Rendimentos",
		0.07,
		"Proceeds interests and dividends",
		"RESGATE_APLIC_FINANCEIRA",
	),
	acct("mb-07", "2026-10-31", "Pix recebido FULANO DE TAL", 296.76, "Same person transfer", "PIX", {
		paymentData: self(),
	}),
	acct(
		"mb-08",
		"2026-10-13",
		"Rendimentos",
		0.06,
		"Proceeds interests and dividends",
		"RESGATE_APLIC_FINANCEIRA",
	),
	acct(
		"mb-09",
		"2026-10-11",
		"Pagamento de fatura Cartão de crédito",
		-296.44,
		"Transfers",
		"OPERACAO_CREDITO",
	),
	acct(
		"mb-10",
		"2026-10-09",
		"Rendimentos",
		0.07,
		"Proceeds interests and dividends",
		"RESGATE_APLIC_FINANCEIRA",
	),
	acct(
		"mb-11",
		"2026-10-08",
		"Rendimentos",
		0.06,
		"Proceeds interests and dividends",
		"RESGATE_APLIC_FINANCEIRA",
	),
	acct(
		"mb-12",
		"2026-10-07",
		"Rendimentos",
		0.06,
		"Proceeds interests and dividends",
		"RESGATE_APLIC_FINANCEIRA",
	),
	acct(
		"mb-13",
		"2026-10-06",
		"Rendimentos",
		0.06,
		"Proceeds interests and dividends",
		"RESGATE_APLIC_FINANCEIRA",
	),
	acct("mb-14", "2026-10-05", "Pix recebido FULANO DE TAL", 296.44, "Same person transfer", "PIX", {
		paymentData: self(),
	}),
];

const mpCard: Json[] = [
	card("mc-01", "2026-11-05", "MERCADOLIVRE*MERCADOLIVRE", 173.74, "Electronics", "PAGAMENTO", "PENDING", {
		post: "2026-11-05",
		forecast: "2026-11",
		paymentType: "INSTALLMENT",
		n: 11,
		of: 21,
		purchase: "2025-12-11",
	}),
	card(
		"mc-02",
		"2026-10-11",
		"Pagamento recebido",
		-296.44,
		"Credit card payment",
		"PAGAMENTO_FATURA",
		"POSTED",
		{
			billId: "bill-mp-a",
		},
	),
	card("mc-03", "2026-10-05", "CONTA VIVO", 123.02, "Telecommunications", "PAGAMENTO", "PENDING", {
		post: "2026-11-05",
		forecast: "2026-11",
		paymentType: "SINGLE",
	}),
	card("mc-04", "2026-10-05", "MERCADOLIVRE*MERCADOLIVRE", 173.74, "Shopping", null, "POSTED", {
		billId: "bill-mp-a",
		// Postada no dia do fechamento da bill-mp-a e dentro dela: a evidência de `closing-day-included` neste cartão.
		post: "2026-10-05",
		paymentType: "INSTALLMENT",
		n: 10,
		of: 21,
		purchase: "2025-12-11",
	}),
];

const mpBills = [
	bill("bill-mp-a", "2026-10-13", "2026-10-05", 296.44, 44.48, [["2026-10-11", 296.44]]),
	bill("mp-0910", "2026-09-10", "2026-09-05", 293.74, null, [["2026-09-08", 293.74]]),
	bill("mp-0810", "2026-08-10", "2026-08-05", 173.74, null),
	bill("mp-0710", "2026-07-10", "2026-07-05", 173.74, null),
	bill("mp-0610", "2026-06-10", "2026-06-05", 378.26, null),
	bill("mp-0511", "2026-05-11", "2026-05-05", 0, null),
	bill("mp-0410", "2026-04-10", "2026-04-05", 265.62, null, [
		["2026-04-08", 265.62],
		["2026-05-05", 378.44],
	]),
	bill("mp-0310", "2026-03-10", "2026-03-05", 265.62, null),
	bill("mp-0210", "2026-02-10", "2026-02-05", 375.62, null),
	bill("mp-0112", "2026-01-12", "2026-01-05", 0, null),
	bill("mp-1210", "2025-12-10", "2025-12-05", 616.24, null, [
		["2025-12-06", 616.24],
		["2026-01-03", 265.8],
	]),
	bill("mp-1110", "2025-11-10", "2025-11-05", 505.88, null, [
		["2025-11-07", 359.78],
		["2025-11-08", 146.1],
	]),
];

// ------------------------------------------------------------------------------------------- Santander

const santanderBank: Json[] = [
	acct("sb-01", "2026-11-07", "PIX ENVIADO Fulano de Tal", -67.26, "Same person transfer", "PIX", {
		paymentData: self(),
	}),
	acct(
		"sb-02",
		"2026-11-05",
		"REMUNERACAO APLICACAO AUTOMATICA",
		0.01,
		"Proceeds interests and dividends",
		"RENDIMENTO_APLIC_FINANCEIRA",
	),
	acct("sb-03", "2026-11-02", "PIX ENVIADO ASSOCIACAO EDUCACIONAL EXEMPLO", -594.06, "University", "PIX", {
		paymentData: {
			payer: null,
			receiver: { documentNumber: { value: "000" }, name: "ASSOCIACAO EDUCACIONAL EXEMPLO" },
		},
	}),
	acct(
		"sb-04",
		"2026-10-31",
		"DEBITO VISA ELECTRON BRASIL 31/10 SUPERMERCADO EXEMPLO",
		-35.96,
		"Groceries",
		"CARTAO",
	),
	acct("sb-05", "2026-10-31", "PIX ENVIADO Fulano de Tal", -1438.84, "Same person transfer", "PIX", {
		paymentData: self(),
	}),
	acct("sb-06", "2026-10-31", "PIX ENVIADO Fulano de Tal", -1383.88, "Same person transfer", "PIX", {
		paymentData: self(),
	}),
	acct("sb-07", "2026-10-31", "PIX ENVIADO Fulano de Tal", -296.76, "Same person transfer", "PIX", {
		paymentData: self(),
	}),
	acct(
		"sb-08",
		"2026-10-31",
		"PAGAMENTO CARTAO CREDITO BCE 31/10 12:14 CARTAO VISA",
		-783.26,
		"Credit card payment",
		"CARTAO",
		{
			paymentData: { payer: null, receiver: { documentNumber: { value: "000" }, name: "BANCO SANTANDER" } },
		},
	),
	acct("sb-09", "2026-10-31", "PIX RECEBIDO Empresa Exemplo Ltda", 4600, "Transfer - PIX", "PIX", {
		paymentData: {
			payer: { documentNumber: { value: "000" }, name: "EMPRESA EXEMPLO LTDA" },
			receiver: null,
		},
	}),
	acct("sb-10", "2026-10-17", "PIX ENVIADO Fulano de Tal", -55.18, "Same person transfer", "PIX", {
		paymentData: self(),
	}),
	acct(
		"sb-11",
		"2026-10-07",
		"REMUNERACAO APLICACAO AUTOMATICA",
		0.01,
		"Proceeds interests and dividends",
		"RENDIMENTO_APLIC_FINANCEIRA",
	),
	acct("sb-12", "2026-10-05", "PIX ENVIADO ASSOCIACAO EDUCACIONAL EXEMPLO", -594.06, "University", "PIX"),
	acct("sb-13", "2026-10-05", "PIX ENVIADO Fulano de Tal", -296.44, "Same person transfer", "PIX", {
		paymentData: self(),
	}),
	acct("sb-14", "2026-10-05", "PIX ENVIADO Fulano de Tal", -1051.14, "Same person transfer", "PIX", {
		paymentData: self(),
	}),
	acct("sb-15", "2026-10-05", "PIX ENVIADO Fulano de Tal", -1194.54, "Same person transfer", "PIX", {
		paymentData: self(),
	}),
];

const pendingSantander = (
	id: string,
	date: string,
	description: string,
	amount: number,
	category: string,
): Json =>
	card(id, date, description, amount, category, null, "PENDING", {
		forecast: "2026-11",
		paymentType: "SINGLE",
	});

const santanderCard: Json[] = [
	pendingSantander("sc-01", "2026-11-04", "DL*Spotify P48CE", 63.8, "Digital services"),
	pendingSantander("sc-02", "2026-11-02", "DL*hostingercomb", 217.98, "School"),
	pendingSantander("sc-03", "2026-10-31", "PIZZARIA EXEMPLO", 365.6, "Eating out"),
	pendingSantander("sc-04", "2026-10-31", "DL*UberRides", 41.92, "Taxi"),
	pendingSantander("sc-05", "2026-10-31", "Amazon Ad free for PrimeV", 20, "Digital services"),
	pendingSantander("sc-06", "2026-10-31", "DL *UberRides", 33.88, "Taxi"),
	pendingSantander("sc-07", "2026-10-31", "DL*GOOGLE Grok B", 139.9, "Digital services"),
	card("sc-08", "2026-10-31", "PAGAMENTO DE FATURA", -783.26, "Credit card payment", "PAGAMENTO", "PENDING", {
		forecast: "2026-10",
	}),
	pendingSantander("sc-09", "2026-10-30", "Google F1 TV Stream F", 59.8, "Internet"),
	pendingSantander("sc-10", "2026-10-30", "Google App Exemplo", 77.98, "Digital services"),
	card("sc-11", "2026-10-19", "Google YouTube Member", 15.98, "Digital services", null, "POSTED", {
		billId: "bill-sant-a",
	}),
	card("sc-12", "2026-10-14", "MERCADO EXEMPLO VAREJO", 79.94, "Groceries", null, "POSTED", {
		billId: "bill-sant-a",
	}),
	card("sc-13", "2026-10-13", "Google One", 193.98, "Internet", null, "POSTED", { billId: "bill-sant-a" }),
	card("sc-14", "2026-10-07", "Google YouTube", 53.8, "Digital services", null, "POSTED", {
		billId: "bill-sant-a",
	}),
	card("sc-15", "2026-10-05", "PAGAMENTO DE FATURA", -1408.66, "Credit card payment", "PAGAMENTO", "POSTED", {
		billId: "bill-sant-a",
	}),
];

const santanderBills = [
	bill("sant-1107", "2026-11-07", "2026-10-30", 783.26, 78.32, [["2026-10-05", 1408.66]]),
	bill("bill-sant-a", "2026-10-07", "2026-09-30", 1408.66, null, [["2026-09-08", 751.32]]),
	bill("sant-0907", "2026-09-07", "2026-08-31", 751.32, null, [["2026-08-07", 989.66]]),
	bill("sant-0807", "2026-08-07", "2026-07-31", 1009.66, null, [["2026-07-06", 1142.48]]),
	bill("sant-0707", "2026-07-07", "2026-06-30", 1142.48, null),
	bill("sant-0607", "2026-06-07", "2026-05-29", 687.26, null),
	bill("sant-0507", "2026-05-07", "2026-04-29", 677.3, null),
	bill("sant-0407", "2026-04-07", "2026-03-30", 604.04, null),
	bill("sant-0307", "2026-03-07", "2026-03-02", 1328.52, null),
	bill("sant-0207", "2026-02-07", "2026-02-02", 625.44, null),
	bill("sant-0107", "2026-01-07", "2025-12-30", 887.92, null),
	bill("sant-1207", "2025-12-07", "2025-12-01", 760.32, null),
];

// ----------------------------------------------------------------------------------------------- Nubank

const nubankBank: Json[] = [
	acct("nb-01", "2026-11-04", "Pagamento de fatura", -1438.84, "Transfers", "OUTROS"),
	acct(
		"nb-02",
		"2026-10-31",
		"Transferência Recebida|FULANO DE TAL",
		1438.84,
		"Same person transfer",
		"PIX",
		{
			paymentData: self(),
		},
	),
	acct(
		"nb-03",
		"2026-10-17",
		"Transferência enviada pelo Pix|FULANO DE TAL",
		-138.68,
		"Same person transfer",
		"PIX",
		{
			paymentData: self(),
		},
	),
	acct("nb-04", "2026-10-13", "Pagamento de fatura", -1055.86, "Transfers", "OUTROS"),
	acct(
		"nb-05",
		"2026-10-05",
		"Transferência Recebida|FULANO DE TAL",
		1194.54,
		"Same person transfer",
		"PIX",
		{
			paymentData: self(),
		},
	),
];

const nubankCard: Json[] = [
	card("nc-01", "2026-11-05", "Farmacia Exemplo", 95.96, "Pharmacy", null, "PENDING", {
		forecast: "2026-12",
	}),
	card(
		"nc-02",
		"2026-11-04",
		"Pagamento recebido",
		-1438.84,
		"Credit card payment",
		"PAGAMENTO_FATURA",
		"PENDING",
		{
			forecast: "2026-12",
		},
	),
	card("nc-03", "2026-11-03", "Centauro Com 4/6", 153.32, "Shopping", null, "PENDING", {
		forecast: "2026-12",
		paymentType: "INSTALLMENT",
		n: 4,
		of: 6,
		purchase: "2026-08-10",
	}),
	card(
		"nc-04",
		"2026-10-22",
		"IOF gerado por compra em moeda estrangeira",
		5.8,
		"Tax on financial operations",
		"TARIFA",
		"POSTED",
		{
			billId: "bill-nu-a",
			forecast: "2026-11",
		},
	),
	card("nc-05", "2026-10-21", "Openrouter, Inc", 31.66, "Digital services", null, "POSTED", {
		billId: "bill-nu-a",
	}),
	card("nc-06", "2026-10-20", "Higgsfield Inc.", 41.48, "Digital services", null, "POSTED", {
		billId: "bill-nu-a",
	}),
	card("nc-07", "2026-10-17", "Mp *Melimais", 19.8, "Shopping", null, "POSTED", { billId: "bill-nu-a" }),
	card(
		"nc-08",
		"2026-10-13",
		"Pagamento recebido",
		-1055.86,
		"Credit card payment",
		"PAGAMENTO_FATURA",
		"POSTED",
		{
			billId: "bill-nu-a",
		},
	),
	card("nc-09", "2026-10-09", "Mercado Exemplo", 36.32, "Groceries", null, "POSTED", {
		billId: "bill-nu-a",
	}),
	card("nc-10", "2026-10-08", "Padaria Exemplo", 48.9, "Groceries", null, "POSTED", { billId: "bill-nu-a" }),
	card("nc-11", "2026-10-07", "Opencode", 20, "Electronics", null, "POSTED", { billId: "bill-nu-a" }),
];

const nubankBills = [
	bill("nu-1110", "2026-11-10", "2026-11-03", 1438.8426, 215.8234, [["2026-11-03", 1438.84]]),
	bill("bill-nu-a", "2026-10-13", "2026-10-03", 1055.8631, null, [["2026-10-13", 1055.86]]),
	bill("nu-0910", "2026-09-10", "2026-09-03", 1173.1043, null),
	bill("nu-0810", "2026-08-10", "2026-08-03", 891.2843, null),
	bill("nu-0710", "2026-07-10", "2026-07-03", 995.3558, null),
	bill("nu-0610", "2026-06-10", "2026-06-03", 895.2214, null),
	bill("nu-0511", "2026-05-11", "2026-05-03", 0.0043, null),
	bill("nu-0410", "2026-04-10", "2026-04-03", 972.7167, null, [
		["2026-04-07", 972.72],
		["2026-04-30", 605.88],
	]),
	bill("nu-0310", "2026-03-10", "2026-03-03", 1837.3405, null),
	bill("nu-0210", "2026-02-10", "2026-02-03", 1367.4756, null),
	bill("nu-0112", "2026-01-12", "2026-01-03", 924.4375, null),
	bill("nu-1210", "2025-12-10", "2025-12-03", 397.5975, null),
	bill("nu-1110b", "2025-11-10", "2025-11-03", -0.0025, null),
];

// ------------------------------------------------------------------------------------------------ montagem

/** Os dados dos 4 bancos no formato do `fakePluggy` (Inter é o item principal; os outros 3 vão em `otherItems`). */
export function realPluggyOptions(): FakePluggyOptions & { itemId: string } {
	const accounts = {
		inter: [
			bankAccount(ACCOUNTS.interBank, ITEMS.inter, "BANCO INTER", "4410", 0),
			bankAccount(ACCOUNTS.interSavings, ITEMS.inter, "BANCO INTER", "4410", 0, "SAVINGS_ACCOUNT"),
			cardAccount(ACCOUNTS.interCard, ITEMS.inter, "GOLD", "8316", 618, {
				limit: 11320,
				available: 10702,
				minimum: 0,
				brand: "MASTERCARD",
				level: "GOLD",
			}),
		],
		mp: [
			bankAccount(ACCOUNTS.mpBank, ITEMS.mp, "Mercado Pago (Conta Pré-paga)", "3965", 410.58),
			cardAccount(ACCOUNTS.mpCard, ITEMS.mp, "Mercado Pago", "7054", 1737.4, {
				limit: 14000,
				available: 12262.6,
				minimum: 44.48,
				brand: "VISA",
				level: "STANDARD",
			}),
		],
		santander: [
			bankAccount(ACCOUNTS.santanderBank, ITEMS.santander, "Santander", "5821", 0),
			cardAccount(ACCOUNTS.santanderCard, ITEMS.santander, "FREE VISA", "2689", 1074.66, {
				limit: 11540,
				available: 10465.34,
				minimum: 78.32,
				brand: "VISA",
				level: "GOLD",
			}),
		],
		nubank: [
			bankAccount(ACCOUNTS.nubankBank, ITEMS.nubank, "Nu (Conta Pré-paga)", "6237", 0),
			cardAccount(ACCOUNTS.nubankCard, ITEMS.nubank, "gold", "5172", 555.92, {
				limit: 13900,
				available: 5244.08,
				minimum: 215.8234,
				brand: "MASTERCARD",
				level: "GOLD",
			}),
		],
	};
	return {
		itemId: ITEMS.inter,
		item: { connector: connector(200) },
		accounts: accounts.inter,
		otherItems: {
			[ITEMS.mp]: { accounts: accounts.mp, item: { connector: connector(201) } },
			[ITEMS.santander]: { accounts: accounts.santander, item: { connector: connector(202) } },
			[ITEMS.nubank]: { accounts: accounts.nubank, item: { connector: connector(203) } },
		},
		transactions: {
			[ACCOUNTS.interBank]: interBank,
			[ACCOUNTS.interSavings]: [],
			[ACCOUNTS.interCard]: interCard,
			[ACCOUNTS.mpBank]: mpBank,
			[ACCOUNTS.mpCard]: mpCard,
			[ACCOUNTS.santanderBank]: santanderBank,
			[ACCOUNTS.santanderCard]: santanderCard,
			[ACCOUNTS.nubankBank]: nubankBank,
			[ACCOUNTS.nubankCard]: nubankCard,
		},
		bills: {
			[ACCOUNTS.interCard]: interBills,
			[ACCOUNTS.mpCard]: mpBills,
			[ACCOUNTS.santanderCard]: santanderBills,
			[ACCOUNTS.nubankCard]: nubankBills,
		},
	};
}
