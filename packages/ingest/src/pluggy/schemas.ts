import { z } from "zod";

/*
 * Respostas do Pluggy (formato conferido contra o SDK oficial pluggy-sdk 0.94.2: dist/types/{account,transaction,
 * item,common,creditCardBills}.d.ts; ver docs/pluggy.md). Tudo que vem de fora passa por aqui antes de virar dado do Órbita. Só os campos que o
 * Órbita usa são exigidos. A conta (`accountSchema`) e os investimentos usam `.passthrough()`: chave desconhecida
 * passa, só para o diagnóstico listar o NOME dela; os demais schemas descartam chave desconhecida. Campos que o Pluggy
 * pode omitir ou mandar `null` são `nullish`.
 * Os nomes seguem https://docs.pluggy.ai/reference (ver docs/pluggy.md: o que foi conferido e o que é suposição).
 */

const id = z.string().min(1).max(100);
const text = z.string().max(500);
const money = z.union([z.number(), z.string().regex(/^-?\d{1,12}(\.\d+)?$/)]);

export const authResponse = z.object({ apiKey: z.string().min(10).max(4000) });

/** `POST /connect_token` (SDK 0.94.2: `createConnectToken` → `{ accessToken }`). Vale para abrir o widget, não para a API. */
export const connectTokenResponse = z.object({ accessToken: z.string().min(10).max(4000) });

export const itemResponse = z.object({
	id,
	status: z.string().max(60),
	executionStatus: z.string().max(60).nullish(),
	lastUpdatedAt: z.string().max(40).nullish(),
	/** Quando o item foi criado (SDK 0.94.2: `Item.createdAt`). Serve para recusar item antigo no "Conectar banco". */
	createdAt: z.string().max(40).nullish(),
	/**
	 * `isSandbox`: conector de teste (SDK 0.94.2, types/connector.d.ts). `isOpenFinance`: o conector usa as APIs
	 * regulamentadas do Open Finance (docs.pluggy.ai/reference/items-retrieve, `connector.isOpenFinance`): só nele vêm
	 * `providerId`, `billId`, `billForecastDate` e o `operationType` do Open Finance. Valor estranho vira `null`.
	 */
	connector: z
		.object({
			id: z.number().nullish(),
			name: text,
			isSandbox: z.boolean().nullish(),
			/** Só o diagnóstico lê: conector Open Finance regulado ou direto, e o tipo (PERSONAL_BANK…). */
			isOpenFinance: z.boolean().nullish().catch(null),
			type: z.string().max(60).nullish().catch(null),
		})
		.nullish(),
	/** Por produto (`accounts`, `creditCards`, `transactions`…): se atualizou e os avisos. Só o diagnóstico lê. */
	statusDetail: z
		.record(
			z.string().max(60),
			z
				.object({
					isUpdated: z.boolean().nullish().catch(null),
					lastUpdatedAt: z.string().max(40).nullish().catch(null),
					warnings: z
						.array(
							z.object({
								code: z
									.union([z.string().max(60), z.number()])
									.nullish()
									.catch(null),
								message: z.string().max(1000).nullish().catch(null),
							}),
						)
						.max(20)
						.nullish()
						.catch(null),
				})
				.nullish()
				.catch(null),
		)
		.nullish()
		.catch(null),
	/** Produtos pedidos para o item ("INVESTMENTS", "INVESTMENTS_TRANSACTIONS"…; docs.pluggy.ai/docs/connections/item). Só o diagnóstico lê. */
	products: z.array(z.string().max(60)).max(50).nullish().catch(null),
	nextAutoSyncAt: z.string().max(40).nullish().catch(null),
	consentExpiresAt: z.string().max(40).nullish().catch(null),
	/** Erro do item (SDK: `error { code, message }`). Só o diagnóstico lê; texto de terceiro, nunca instrução. */
	error: z
		.object({
			code: z.string().max(100).nullish().catch(null),
			message: z.string().max(1000).nullish().catch(null),
		})
		.nullish()
		.catch(null),
});
export type PluggyItem = z.infer<typeof itemResponse>;

/*
 * Leitura tolerante, mas não muda: campo opcional ausente ou `null` vale `null`; campo PRESENTE com tipo errado vira
 * `null` e campo mais longo que o limite é cortado, e os dois ficam registrados em `fieldProblems` da linha
 * ("campo: invalid_type" / "campo: truncated"; só o nome do campo e o código, nunca o valor). Isso não recusa a
 * linha: o sync mostra como nota e o Diagnóstico lista.
 */
const MAX_FIELD_PROBLEMS = 20;

class Problems {
	readonly list: string[] = [];
	add(path: string, code: "invalid_type" | "truncated"): void {
		const entry = `${path}: ${code}`;
		if (this.list.length < MAX_FIELD_PROBLEMS && !this.list.includes(entry)) this.list.push(entry);
	}
}

/** Texto opcional: ausente/`null` → `null`; não-texto → `null` e `invalid_type`; acima de `max` → cortado e `truncated`. */
function readText(raw: unknown, path: string, max: number, problems: Problems): string | null {
	if (raw === undefined || raw === null) return null;
	if (typeof raw !== "string") {
		problems.add(path, "invalid_type");
		return null;
	}
	if (raw.length > max) {
		problems.add(path, "truncated");
		return raw.slice(0, max);
	}
	return raw;
}

function readMoney(raw: unknown, path: string, problems: Problems): Money {
	if (raw === undefined || raw === null) return null;
	const parsed = money.safeParse(raw);
	if (parsed.success) return parsed.data;
	problems.add(path, "invalid_type");
	return null;
}

/** Objeto opcional: ausente/`null` → `null`; outra coisa que não objeto → `null` e `invalid_type`. */
function readObject(raw: unknown, path: string, problems: Problems): Record<string, unknown> | null {
	if (raw === undefined || raw === null) return null;
	if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
	problems.add(path, "invalid_type");
	return null;
}

function readCreditData(raw: unknown, problems: Problems): PluggyAccount["creditData"] {
	const c = readObject(raw, "creditData", problems);
	if (c === null) return null;
	return {
		/** Fechamento e vencimento da fatura atual (data). O Órbita guarda só o dia. */
		balanceCloseDate: readText(c.balanceCloseDate, "creditData.balanceCloseDate", 40, problems),
		balanceDueDate: readText(c.balanceDueDate, "creditData.balanceDueDate", 40, problems),
		creditLimit: readMoney(c.creditLimit, "creditData.creditLimit", problems),
		/** Limite ainda disponível (SDK 0.94.2: `availableCreditLimit`). Valor estranho vira `null`: não derruba a conta. */
		availableCreditLimit: readMoney(c.availableCreditLimit, "creditData.availableCreditLimit", problems),
		/** Só o diagnóstico lê estes três (o sync não usa). */
		minimumPayment: readMoney(c.minimumPayment, "creditData.minimumPayment", problems),
		brand: readText(c.brand, "creditData.brand", 60, problems),
		level: readText(c.level, "creditData.level", 60, problems),
	};
}

/** Últimos 4 dígitos do número (cartão "5502 **** **** 4321" → "4321"), do valor ORIGINAL, antes de qualquer corte. */
export function last4Of(number: string | null | undefined): string | null {
	const digits = (number ?? "").replace(/\D/g, "");
	return digits.length >= 4 ? digits.slice(-4) : null;
}

/**
 * Conta do Pluggy. TOLERANTE de propósito: só `id` e `type` são exigidos. A doc marca `subtype`, `number`, `balance`,
 * `currencyCode` e `name` como sempre presentes (docs.pluggy.ai/docs/products/accounts), mas cada banco preenche do
 * seu jeito ("what arrives depends on what each institution exposes": /docs/connections/open-finance-vs-direct-fields)
 * e um campo `null`, mais longo ou de outro tipo não pode fazer a conta sumir: vira `null` (ou é cortado) e fica em
 * `fieldProblems`. Duas exceções de propósito: `currencyCode` AUSENTE vale BRL (como sempre valeu), mas PRESENTE e
 * ilegível recusa a conta (sem saber a moeda, tratar como real misturaria moedas); e o que não tem `id` ou `type` é
 * recusado. A recusada é CONTADA pelo cliente (`accountsRead`) com o motivo ("currencyCode: invalid_type"), nunca
 * descartada em silêncio.
 * `.passthrough()`: o diagnóstico lista os NOMES dos campos que vieram e o Órbita não lê (nunca os valores).
 */
export const accountFields = z
	.object({
		id,
		/** "BANK" ou "CREDIT" (SDK: ACCOUNT_TYPES); outros valores chegam como texto e são ignorados no mapeamento, com aviso. */
		type: z.string().min(1).max(40),
		/** Ausente/`null` vale BRL; texto de outro tipo é `invalid_type` e recusa a conta (ver acima). */
		currencyCode: z.string().nullish(),
		subtype: z.unknown().optional(),
		name: z.unknown().optional(),
		marketingName: z.unknown().optional(),
		number: z.unknown().optional(),
		taxNumber: z.unknown().optional(),
		owner: z.unknown().optional(),
		balance: z.unknown().optional(),
		creditData: z.unknown().optional(),
		bankData: z.unknown().optional(),
	})
	.passthrough();

export const accountSchema = accountFields.transform((raw): PluggyAccount => {
	const problems = new Problems();
	const { id: accountId, type, currencyCode, ...rest } = raw;
	const number = readText(raw.number, "number", 60, problems);
	// O número pode vir mais longo que o limite: os 4 últimos dígitos saem do valor original.
	const numberLast4 = typeof raw.number === "string" ? last4Of(raw.number) : null;
	const bank = readObject(raw.bankData, "bankData", problems);
	const nameRaw = readText(raw.name, "name", 500, problems);
	return {
		...rest,
		id: accountId,
		type,
		/** `CHECKING_ACCOUNT` / `SAVINGS_ACCOUNT` / `CREDIT_CARD` na doc; valor novo passa como texto. */
		subtype: readText(raw.subtype, "subtype", 60, problems),
		/** Sem nome (ou ilegível) vira "": o mapeamento dá um nome gerado (banco + tipo). */
		name: nameRaw ?? "",
		marketingName: readText(raw.marketingName, "marketingName", 500, problems),
		number,
		numberLast4,
		/** CPF/CNPJ do titular, SEM corte: serve para reconhecer transferência entre contas do próprio dono. */
		taxNumber: readText(raw.taxNumber, "taxNumber", 200, problems),
		/** Nome do titular da conta. Serve (com o CPF) para reconhecer Pix entre contas do próprio dono. */
		owner: readText(raw.owner, "owner", 200, problems),
		currencyCode: typeof currencyCode === "string" ? currencyCode.slice(0, 10) : null,
		/**
		 * Saldo em reais (número JSON). Na conta BANK é o saldo da conta; no cartão, o que se deve. Nunca multiplique por
		 * 100: use `decimalToCents`. Valor estranho vira `null`.
		 */
		balance: raw.balance === undefined ? undefined : readMoney(raw.balance, "balance", problems),
		creditData: readCreditData(raw.creditData, problems),
		/**
		 * `transferNumber`: "COMPE / Agência / Conta" (docs.pluggy.ai/docs/products/accounts, "Bank data"). O COMPE diz de
		 * qual banco é a conta quando o nome não diz ("Conta Corrente"). Valor estranho vira `null`.
		 */
		bankData:
			bank === null
				? null
				: { transferNumber: readText(bank.transferNumber, "bankData.transferNumber", 60, problems) },
		fieldProblems: problems.list,
	};
});
type Money = number | string | null;
/**
 * A conta já validada. Escrita à mão (e não `z.infer`) para os campos opcionais continuarem opcionais: o schema os
 * devolve sempre (como `null` quando faltam), mas quem monta uma conta em teste não precisa repetir todos.
 */
export interface PluggyAccount {
	id: string;
	type: string;
	name: string;
	subtype?: string | null | undefined;
	marketingName?: string | null | undefined;
	number?: string | null | undefined;
	/** Últimos 4 dígitos do `number` ORIGINAL (antes do corte). Ausente: o mapeamento calcula do `number`. */
	numberLast4?: string | null | undefined;
	taxNumber?: string | null | undefined;
	owner?: string | null | undefined;
	currencyCode?: string | null | undefined;
	balance?: Money | undefined;
	creditData?:
		| {
				balanceCloseDate?: string | null | undefined;
				balanceDueDate?: string | null | undefined;
				creditLimit?: Money | undefined;
				availableCreditLimit?: Money | undefined;
				minimumPayment?: Money | undefined;
				brand?: string | null | undefined;
				level?: string | null | undefined;
		  }
		| null
		| undefined;
	bankData?: { transferNumber?: string | null } | null | undefined;
	/** Campos opcionais descartados ou cortados ("campo: invalid_type" / "campo: truncated"). Nunca o valor. */
	fieldProblems?: string[] | undefined;
}

const participant = z.object({
	documentNumber: z.object({ value: z.string().max(40).nullish() }).nullish(),
	name: z.string().max(200).nullish(),
});

export const transactionSchema = z.object({
	id,
	description: z.string().max(1000).nullish(),
	descriptionRaw: z.string().max(1000).nullish(),
	currencyCode: z.string().max(10).nullish(),
	/** Em reais, número JSON (float). Nunca multiplique por 100: use `decimalToCents`. */
	amount: money,
	amountInAccountCurrency: money.nullish(),
	date: z.string().min(8).max(40),
	/** "DEBIT" (saiu dinheiro / compra) ou "CREDIT" (entrou dinheiro). */
	type: z.string().max(20),
	/** "POSTED" ou "PENDING". */
	status: z.string().max(20).nullish(),
	category: z.string().max(200).nullish(),
	categoryId: z.string().max(40).nullish(),
	/**
	 * Tipo da operação segundo a instituição, só em conectores Open Finance (docs.pluggy.ai/docs/transactions e
	 * /reference/transactions-list). Na conta: TED, DOC, PIX, RENDIMENTO_APLIC_FINANCEIRA, RESGATE_APLIC_FINANCEIRA…;
	 * no cartão: PAGAMENTO, PAGAMENTO_FATURA, TARIFA, OPERACOES_CREDITO_CONTRATADAS_CARTAO, ESTORNO, CASHBACK, OUTROS.
	 * Sinal PRIMÁRIO do tipo do lançamento (ver `operationSignal`); texto estranho vira `null`.
	 */
	operationType: z.string().max(100).nullish().catch(null),
	/** Id do lançamento no banco (docs: "Only returned for Open Finance connectors"): âncora contra recriação com id novo. */
	providerId: z.string().max(200).nullish().catch(null),
	/** Código da instituição (NSU, número no extrato; "format varies per institution"): âncora mais fraca. */
	providerCode: z.string().max(200).nullish().catch(null),
	/** Quem pagou e quem recebeu (Pix/TED). Os documentos (CPF/CNPJ) revelam transferência entre contas próprias. */
	paymentData: z
		.object({
			payer: participant.nullish(),
			receiver: participant.nullish(),
		})
		.nullish(),
	creditCardMetadata: z
		.object({
			installmentNumber: z.number().int().nullish(),
			totalInstallments: z.number().int().nullish(),
			billId: z.string().max(100).nullish(),
			/** Valor total da compra parcelada (o SDK descreve como "valor da parcela": ambíguo; não decide nada). */
			totalAmount: money.nullish().catch(null),
			/** MCC do estabelecimento (número no SDK; pode chegar como texto). */
			payeeMCC: z
				.union([z.number(), z.string().max(10)])
				.nullish()
				.catch(null),
			/** Data original da compra (a mesma para todas as parcelas). */
			purchaseDate: z.string().max(40).nullish().catch(null),
			/** Só o diagnóstico lê (docs: parcelas futuras vêm com a data de lançamento na fatura). */
			billPostDate: z.string().max(40).nullish().catch(null),
			paymentType: z.string().max(60).nullish().catch(null),
			/**
			 * Fatura (AAAA-MM) em que a compra deve ser cobrada. "Unlike billId, it is provided for pending and future
			 * transactions too. Only returned for Open Finance connectors" (docs.pluggy.ai/reference/transactions-list).
			 */
			billForecastDate: z.string().max(40).nullish().catch(null),
			/** Tipo da tarifa, quando a operação é TARIFA (ANNUAL_FEE, SMS, OTHER…; mesma página). */
			feeType: z.string().max(60).nullish().catch(null),
			/** Crédito contratado no cartão, quando a operação é OPERACOES_CREDITO_CONTRATADAS_CARTAO (REVOLVING_CREDIT, BILL_INSTALLMENT, LOAN, OTHER). */
			otherCreditsType: z.string().max(60).nullish().catch(null),
		})
		.nullish(),
	/** Dados do estabelecimento (SDK 0.94.2: `TransactionMerchantData`). Só o que ajuda a categorizar. */
	merchant: z
		.object({
			name: z.string().max(300).nullish().catch(null),
			businessName: z.string().max(300).nullish().catch(null),
			cnae: z.string().max(40).nullish().catch(null),
			category: z.string().max(200).nullish().catch(null),
		})
		.nullish()
		.catch(null),
});
export type PluggyTransaction = z.infer<typeof transactionSchema>;

/** Paginação por cursor (`GET /v2/transactions`): `next` é um link com `?after=`, ou `null` na última página. */
export const cursorPage = <T extends z.ZodType>(item: T) =>
	z.object({ results: z.array(item).max(1000), next: z.string().max(2000).nullable() });

/** Fatura do cartão (`GET /bills`): datas, total, mínimo e os pagamentos feitos nela. */
export const billSchema = z.object({
	id,
	/** Vencimento: o mês dele é o mês da fatura no Órbita (`Invoice.month`). */
	dueDate: z.string().max(40).nullish().catch(null),
	/** Fechamento da fatura (SDK 0.94.2: `billClosingDate`, `Date | null`). Com o vencimento, dá o dia de fechamento do cartão. */
	billClosingDate: z.string().max(40).nullish().catch(null),
	totalAmount: money.nullish().catch(null),
	/** Moeda do total (SDK: `totalAmountCurrencyCode`). Fatura que não é BRL não é gravada. */
	totalAmountCurrencyCode: z.string().max(10).nullish().catch(null),
	/** Pagamento mínimo (SDK: `minimumPaymentAmount`). Valor estranho vira `null`. */
	minimumPaymentAmount: money.nullish().catch(null),
	payments: z
		.array(
			z.object({
				/** Id do pagamento no banco, quando informa. */
				id: z.string().max(100).nullish().catch(null),
				paymentDate: z.string().max(40),
				amount: money,
				currencyCode: z.string().max(10).nullish(),
			}),
		)
		.max(200)
		.default([]),
});
export type PluggyBill = z.infer<typeof billSchema>;

/**
 * Categoria do Pluggy (`GET /categories`, SDK 0.94.2: types/category.d.ts). O que importa é a hierarquia
 * (`parentId`/`parentDescription`): a folha ("Pharmacy") diz pouco sem a raiz ("Healthcare").
 */
export const categorySchema = z.object({
	id,
	description: text,
	parentId: id.nullish(),
	parentDescription: text.nullish(),
});
export type PluggyCategory = z.infer<typeof categorySchema>;

/** Paginação por página: `results` + `totalPages` (`total` também vem, mas não é usado). */
export const page = <T extends z.ZodType>(item: T) =>
	z.object({
		results: z.array(item).max(1000),
		page: z.number().int().nonnegative(),
		totalPages: z.number().int().nonnegative(),
	});

/*
 * Investimentos (docs.pluggy.ai/docs/products/investments, /docs/products/investment-transactions e as referências
 * `investments-list`, `investments-retrieve`, `investment-transactions-list`; resumo em docs/pluggy.md, "Investimentos").
 * Schema TOLERANTE de propósito: só o `id` é exigido. A doc marca `name`, `type`, `balance` e `date` como sempre
 * presentes, mas as conexões do dono são MeuPluggy (não Open Finance) e a doc não promete nada por campo para elas;
 * tudo o mais é `nullish` e valor estranho vira `null` (`.catch(null)`) em vez de derrubar a posição.
 * `.passthrough()`: o diagnóstico lista os NOMES dos campos que vieram e o Órbita ainda não lê (nunca os valores).
 * Dinheiro chega em reais (número JSON); quem usa converte com `decimalToCents` (ver `investments.ts`).
 */
const decimal = money.nullish().catch(null);
const shortText = (max: number) => z.string().max(max).nullish().catch(null);
const dateText = z.string().max(40).nullish().catch(null);

export const investmentSchema = z
	.object({
		id,
		/** FIXED_INCOME, MUTUAL_FUND, EQUITY, ETF, SECURITY, COE, OTHER. Texto livre: valor novo não quebra. */
		type: shortText(40),
		/** CDB, LCI, TREASURY, STOCK, REAL_ESTATE_FUND, INVESTMENT_FUND, RETIREMENT… */
		subtype: shortText(60),
		name: shortText(500),
		/** Ticker, ou o CNPJ do fundo. */
		code: shortText(60),
		isin: shortText(20),
		currencyCode: shortText(10),
		/** Saldo LÍQUIDO atual (depois de taxas e impostos). */
		balance: decimal,
		/** Valor BRUTO (com impostos). */
		amount: decimal,
		/** Valor originalmente aplicado. */
		amountOriginal: decimal,
		/** Lucro líquido até aqui (negativo = perda). A doc avisa: `null` em conector Open Finance. */
		amountProfit: decimal,
		/** Disponível para resgate. */
		amountWithdrawal: decimal,
		/** IR e IOF informados/provisionados. */
		taxes: decimal,
		taxes2: decimal,
		/** Valor da cota em `date` e quantidade de cotas/ações. NÃO são centavos: guardar como decimal em texto. */
		value: decimal,
		quantity: decimal,
		/** Remuneração CONTRATADA da renda fixa (ex.: 110% do CDI; 12,5% a.a.). Não é rentabilidade medida. */
		rate: decimal,
		rateType: shortText(20),
		fixedAnnualRate: decimal,
		/** Rentabilidade medida ("returned for funds"); `null` em conector Open Finance. */
		annualRate: decimal,
		lastMonthRate: decimal,
		lastTwelveMonthsRate: decimal,
		/** Data de referência do valor (fim de semana → último dia útil). */
		date: dateText,
		dueDate: dateText,
		issueDate: dateText,
		purchaseDate: dateText,
		issuer: shortText(300),
		/** ACTIVE, PENDING, TOTAL_WITHDRAWAL. */
		status: shortText(40),
		/** Corretora/instituição que guarda o ativo ("only returned in CEI B3 Connector", segundo a doc). */
		institution: z
			.object({ name: shortText(300), number: shortText(40) })
			.nullish()
			.catch(null),
	})
	.passthrough();
export type PluggyInvestment = z.infer<typeof investmentSchema>;

/** Movimentação de um investimento (`GET /investments/{id}/transactions`). Só o `id` é exigido. */
export const investmentTransactionSchema = z
	.object({
		id,
		/** BUY, SELL, TAX, TRANSFER, INTEREST, AMORTIZATION. */
		type: shortText(40),
		/** CREDIT (entra dinheiro na posição; padrão do BUY) ou DEBIT (sai). */
		movementType: shortText(20),
		/** Data da operação e data da liquidação. */
		date: dateText,
		tradeDate: dateText,
		description: shortText(1000),
		quantity: decimal,
		/** Preço unitário e valor bruto da operação. */
		value: decimal,
		amount: decimal,
		/** Valor com as despesas. */
		netAmount: decimal,
		/** Despesas da nota (corretagem, IR, IOF…). A doc diz que vem em Open Finance e Meu Pluggy; os nomes passam, os valores não são lidos. */
		expenses: z.record(z.string().max(60), z.unknown()).nullish().catch(null),
	})
	.passthrough();
export type PluggyInvestmentTransaction = z.infer<typeof investmentTransactionSchema>;
