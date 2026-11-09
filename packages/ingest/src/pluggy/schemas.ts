import { z } from "zod";

/*
 * Respostas do Pluggy (formato conferido contra o SDK oficial pluggy-sdk 0.94.2: dist/types/{account,transaction,
 * item,common,creditCardBills}.d.ts; ver docs/pluggy.md). Tudo que vem de fora passa por aqui antes de virar dado do Órbita. Só os campos que o
 * Órbita usa são exigidos; os demais são ignorados (o Zod descarta chave desconhecida). Campos que o Pluggy
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

const creditData = z.object({
	/** Fechamento e vencimento da fatura atual (data). O Órbita guarda só o dia. */
	balanceCloseDate: z.string().max(40).nullish(),
	balanceDueDate: z.string().max(40).nullish(),
	creditLimit: money.nullish(),
	/** Limite ainda disponível (SDK 0.94.2: `availableCreditLimit`). Valor estranho vira `null`: não derruba a conta. */
	availableCreditLimit: money.nullish().catch(null),
	/** Só o diagnóstico lê estes três (o sync não usa). */
	minimumPayment: money.nullish().catch(null),
	brand: z.string().max(60).nullish().catch(null),
	level: z.string().max(60).nullish().catch(null),
});

export const accountSchema = z.object({
	id,
	/** "BANK" ou "CREDIT" (SDK: ACCOUNT_TYPES); outros valores chegam como texto e são ignorados no mapeamento. */
	type: z.string().max(40),
	subtype: z.string().max(60).nullish(),
	name: text,
	marketingName: text.nullish(),
	number: z.string().max(60).nullish(),
	/** CPF/CNPJ do titular. Serve para reconhecer transferência entre contas do próprio dono. */
	taxNumber: z.string().max(40).nullish(),
	/** Nome do titular da conta. Serve (com o CPF) para reconhecer Pix entre contas do próprio dono. */
	owner: z.string().max(200).nullish(),
	currencyCode: z.string().max(10).nullish(),
	/**
	 * Saldo em reais (número JSON). Na conta BANK é o saldo da conta; no cartão, o que se deve. Nunca multiplique por
	 * 100: use `decimalToCents`. Valor estranho vira `null`.
	 */
	balance: money.nullish().catch(null),
	creditData: creditData.nullish(),
});
export type PluggyAccount = z.infer<typeof accountSchema>;

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
			billForecastDate: z.string().max(20).nullish().catch(null),
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
	dueDate: z.string().max(40).nullish(),
	/** Fechamento da fatura (SDK 0.94.2: `billClosingDate`, `Date | null`). Com o vencimento, dá o dia de fechamento do cartão. */
	billClosingDate: z.string().max(40).nullish(),
	totalAmount: money.nullish(),
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
