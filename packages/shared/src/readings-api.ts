import { z } from "zod";
import { monthKeySchema } from "./finance-primitives.ts";

/*
 * Respostas das leituras que usam os números do banco (saldo, limite disponível, faturas): contrato entre a API e o
 * app. Tudo já vem calculado (o app só exibe) e em centavos inteiros; percentuais são só para mostrar.
 */

const cents = z.number().int();
const isoDateTime = z.string();

// ---------------------------------------------------------------- limite

/** De onde vem o "usado" do limite: o que o banco informou ou a estimativa do Órbita (cartão sem número do banco). */
export const LIMIT_SOURCES = ["bank", "estimated", "none"] as const;
export type LimitSource = (typeof LIMIT_SOURCES)[number];

export const cardLimitDto = z.object({
	/**
	 * Limite EFETIVO. Normalmente o do banco; quando o dono baixou o limite no app do banco, o `creditLimit` da Pluggy
	 * segue sendo o aprovado e o efetivo é disponível + saldo (ver `approvedLimitCents`).
	 */
	limitCents: cents.nullable(),
	/** Limite aprovado pelo banco, só quando é diferente do efetivo (o dono ajustou o limite no app do banco). */
	approvedLimitCents: cents.nullable().optional(),
	/** Quanto ainda dá para gastar: o do banco; sem ele, limite − usado estimado; sem limite, `null`. */
	availableCents: cents.nullable(),
	/** Quanto do limite está em uso: limite − disponível (banco); sem o disponível, o que o Órbita estima. */
	usedCents: cents,
	source: z.enum(LIMIT_SOURCES),
	/** Quando o Órbita leu o limite no banco (`null` se nunca leu). Mostre essa idade ao lado do número. */
	syncedAt: isoDateTime.nullable(),
});
export type CardLimitDto = z.infer<typeof cardLimitDto>;

export const limitsTotalDto = z.object({
	/** Soma só dos cartões com limite conhecido. */
	limitCents: cents,
	usedCents: cents,
	availableCents: cents,
	cardsCounted: z.number().int(),
	/** Cartões sem limite cadastrado (ficam fora dos totais). */
	cardsWithoutLimit: z.number().int(),
	/** A leitura mais antiga entre os cartões que vieram do banco (o total é tão velho quanto o pior). */
	oldestSyncedAt: isoDateTime.nullable(),
});
export type LimitsTotalDto = z.infer<typeof limitsTotalDto>;

// --------------------------------------------------------------- faturas

/** Situação honesta de uma fatura: paga, fechada (a vencer), vencida ou aberta (ainda recebe compras). */
export const INVOICE_STATES = ["paid", "closed", "overdue", "open"] as const;
export type InvoiceState = (typeof INVOICE_STATES)[number];

/** `bank`: total e pagamentos do banco (`/bills`); `ledger`: soma dos lançamentos do Órbita. */
export const INVOICE_TOTAL_SOURCES = ["bank", "ledger"] as const;
export type InvoiceTotalSource = (typeof INVOICE_TOTAL_SOURCES)[number];

export const invoiceHistoryPointDto = z.object({
	/** Mês da fatura (o do vencimento). */
	month: monthKeySchema,
	/** Soma dos cartões nesse mês. */
	totalCents: cents,
	/** `true` se alguma fatura do mês ainda está aberta (o total pode crescer). */
	open: z.boolean(),
	/** Situação do mês: a mais urgente entre os cartões (vencida, fechada, aberta; paga só se todas estão pagas). */
	state: z.enum(INVOICE_STATES),
	byCard: z.array(z.object({ cardId: z.string(), totalCents: cents, state: z.enum(INVOICE_STATES) })),
});
export type InvoiceHistoryPointDto = z.infer<typeof invoiceHistoryPointDto>;

// ----------------------------------------------------------------- saldo

export const accountBalanceLineDto = z.object({
	accountId: z.string(),
	name: z.string(),
	bankCode: z.string().nullable(),
	kind: z.enum(["checking", "savings", "wallet", "investment"]),
	/** `null` quando o banco nunca informou o saldo (conta manual): não é zero. */
	balanceCents: cents.nullable(),
	hasBalance: z.boolean(),
	/** Parte do total, em % com uma casa (só conta com saldo positivo; senão `null`). */
	sharePercent: z.number().nullable(),
	syncedAt: isoDateTime.nullable(),
});
export type AccountBalanceLineDto = z.infer<typeof accountBalanceLineDto>;

export const accountBalancesResponse = z.object({
	/** Soma dos saldos conhecidos (pode incluir negativos, como cheque especial). */
	totalCents: cents,
	accounts: z.array(accountBalanceLineDto),
	/** Contas ativas sem saldo informado (ficam fora do total). */
	withoutBalanceCount: z.number().int(),
	/** A leitura mais antiga entre as contas com saldo. */
	oldestSyncedAt: isoDateTime.nullable(),
});
export type AccountBalancesResponse = z.infer<typeof accountBalancesResponse>;

// ----------------------------------------------------------- fluxo de caixa

export const cashFlowResponse = z.object({
	month: monthKeySchema,
	/** Tudo que entrou nas contas (não cartão) no mês, pela data do lançamento. */
	inCents: cents,
	/** Tudo que saiu das contas: gastos, pagamento de fatura e aplicações. */
	outCents: cents,
	netCents: cents,
	in: z.object({ incomeCents: cents, refundCents: cents, redemptionCents: cents }),
	out: z.object({ expenseCents: cents, cardPaymentCents: cents, investedCents: cents }),
	/** Transferências entre contas próprias, fora dos dois lados (só informativo). */
	ignoredTransferCents: cents,
});
export type CashFlowResponse = z.infer<typeof cashFlowResponse>;

// ---------------------------------------------------- gasto dia a dia

export const dailyPointDto = z.object({ day: z.number().int(), cumulativeCents: cents });

export const spendingDailyResponse = z.object({
	month: monthKeySchema,
	previousMonth: monthKeySchema,
	/** O mesmo Gasto do Início (`loadSpendingMonth`/`summarizeMonth`). */
	spentCents: cents,
	previousSpentCents: cents,
	/** Dia do mês até onde a série do mês vai (hoje no mês atual; o último dia nos meses fechados). */
	throughDay: z.number().int(),
	daysInMonth: z.number().int(),
	/** Acumulado por dia, do dia 1 até `throughDay`. */
	current: z.array(dailyPointDto),
	/** Acumulado do mês anterior inteiro (a linha tracejada). */
	previous: z.array(dailyPointDto),
	/** O que o mês anterior já tinha gasto no mesmo dia (base justa da variação). */
	previousSameDayCents: cents,
	/** Variação do mês até hoje contra o anterior até o mesmo dia, em % com uma casa; `null` sem base. */
	variancePercent: z.number().nullable(),
	topMerchants: z.array(z.object({ name: z.string(), totalCents: cents, count: z.number().int() })),
});
export type SpendingDailyResponse = z.infer<typeof spendingDailyResponse>;

// ---------------------------------------------------------------- parcelas

export const installmentStandingDto = z.object({
	count: z.number().int(),
	/** A parcela vista da fatura vigente ("11 de 21"); `null` se nenhuma já pesou. */
	currentNumber: z.number().int().nullable(),
	/** Valor da parcela vista. */
	installmentCents: cents,
	paidCount: z.number().int(),
	paidCents: cents,
	/** `true` se há parcela paga que o Órbita nunca viu (estimada pelo valor da primeira vista). */
	paidEstimated: z.boolean(),
	/** Parcelas que faltam, a vigente incluída. */
	remainingCount: z.number().int(),
	remainingCents: cents,
	remainingEstimated: z.boolean(),
	totalCents: cents,
	/** O que as parcelas do mês de referência somam. */
	committedMonthCents: cents,
	/** Fatura (mês do vencimento) da última parcela. */
	lastInvoiceMonth: monthKeySchema.nullable(),
});
export type InstallmentStandingDto = z.infer<typeof installmentStandingDto>;
