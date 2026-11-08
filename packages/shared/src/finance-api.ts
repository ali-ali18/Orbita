import { z } from "zod";
import { descriptionSchema, transactionFields, transactionUpdateBody } from "./finance.ts";
import {
	idSchema,
	localDateSchema,
	MAX_CENTS,
	MAX_INSTALLMENT_COUNT,
	monthKeySchema,
	nonNegativeCentsSchema,
	positiveCentsSchema,
	TRANSACTION_KINDS,
	TRANSACTION_SOURCES,
	TRANSACTION_STATUSES,
} from "./finance-primitives.ts";
import { transactionInvariantError } from "./transaction-rules.ts";

/*
 * Corpos e respostas que só a API usa. O cliente nunca manda `invoiceMonth`: quem sabe em
 * qual fatura uma compra cai é o engine, no servidor.
 */

// ------------------------------------------------------------ parâmetros

export const idParam = z.object({ id: idSchema });
export const monthParam = z.object({ month: monthKeySchema });
export const cardInvoiceParam = z.object({ id: idSchema, month: monthKeySchema });
export const budgetScopeParam = z.object({ scope: idSchema });

// ----------------------------------------------------------- lançamentos

/** Lançamento manual. A fatura (compra/estorno no cartão) é calculada pelo servidor. */
// O cliente não manda fatura, mês do orçamento nem situação: o servidor deriva (fatura, mês) ou fixa (lançamento
// manual nasce confirmado; só `/confirm` mexe nisso).
const {
	invoiceMonth: _invoiceMonth,
	budgetMonth: _budgetMonth,
	status: _status,
	...apiTransactionFields
} = transactionFields;
export const transactionApiCreateBody = z
	.object(apiTransactionFields)
	.strict()
	.superRefine((t, ctx) => {
		const isCardRow = Boolean(t.cardId) && t.kind !== "card_payment";
		const message = transactionInvariantError({ ...t, invoiceMonth: isCardRow ? "2000-01" : null });
		if (message) ctx.addIssue({ code: "custom", message });
	});
export type TransactionApiCreateBody = z.infer<typeof transactionApiCreateBody>;

/** Campo ausente fica como está; `null` limpa. Mudou a data de compra no cartão? O servidor refaz a fatura. */
export const transactionApiUpdateBody = transactionUpdateBody
	.omit({ invoiceMonth: true, budgetMonth: true, status: true })
	.strict();
export type TransactionApiUpdateBody = z.infer<typeof transactionApiUpdateBody>;

export const installmentCreateBody = z
	.object({
		cardId: idSchema,
		totalCents: positiveCentsSchema,
		count: z
			.number("O número de parcelas deve ser um número.")
			.int("O número de parcelas deve ser inteiro.")
			.min(2, `O parcelamento vai de 2 a ${MAX_INSTALLMENT_COUNT} parcelas.`)
			.max(MAX_INSTALLMENT_COUNT, `O parcelamento vai de 2 a ${MAX_INSTALLMENT_COUNT} parcelas.`),
		date: localDateSchema,
		description: descriptionSchema,
		categoryId: idSchema.nullish(),
	})
	.strict()
	.refine((b) => b.totalCents >= b.count, {
		message: "O total é menor que o número de parcelas.",
		path: ["totalCents"],
	});
export type InstallmentCreateBody = z.infer<typeof installmentCreateBody>;

/** Uma parte da divisão: valor em centavos, categoria própria e, se quiser, outro nome. */
export const transactionSplitPart = z
	.object({
		amountCents: positiveCentsSchema,
		categoryId: idSchema.nullish(),
		description: descriptionSchema.optional(),
	})
	.strict();
export type TransactionSplitPart = z.infer<typeof transactionSplitPart>;

/**
 * Dividir um lançamento em partes com categorias diferentes. A soma das partes precisa fechar exatamente no
 * valor do original: quem confere é o engine (`checkSplit`), no servidor.
 */
export const transactionSplitBody = z
	.object({
		parts: z
			.array(transactionSplitPart)
			.min(2, "Divida em 2 a 20 partes.")
			.max(20, "Divida em 2 a 20 partes."),
	})
	.strict();
export type TransactionSplitBody = z.infer<typeof transactionSplitBody>;

/** Máximo de itens numa lista de filtro (ids de contas, cartões, categorias). */
export const MAX_FILTER_ITEMS = 50;

/** Lista na URL: `a,b,c`. Vazio equivale a ausente; repetidos contam uma vez. */
const csvList = <T extends z.ZodType>(item: T, max: number) =>
	z.preprocess(
		(raw) => (typeof raw === "string" ? (raw === "" ? undefined : [...new Set(raw.split(","))]) : raw),
		z.array(item).min(1).max(max, `Há itens demais no filtro (máximo ${max}).`).optional(),
	);

/** Parâmetro em branco (`from=`) é o mesmo que ausente. */
const blankAsAbsent = <T extends z.ZodType>(schema: T) =>
	z.preprocess((raw) => (raw === "" ? undefined : raw), schema.optional());

const filterCents = (label: string) =>
	z.coerce
		.number(`${label} deve ser um número.`)
		.int(`${label} deve ser inteiro, em centavos.`)
		.min(0, `${label} não pode ser negativo.`)
		.max(MAX_CENTS, `${label} passa do limite aceito.`);

/**
 * Filtros da lista de lançamentos (todos opcionais, combinados com E). Listas vão separadas por vírgula.
 * `accountIds` e `cardIds` valem juntos como OU ("estas contas ou estes cartões").
 */
export const transactionFilterFields = {
	from: blankAsAbsent(localDateSchema),
	to: blankAsAbsent(localDateSchema),
	kinds: csvList(z.enum(TRANSACTION_KINDS, "Tipo de lançamento inválido."), TRANSACTION_KINDS.length),
	accountIds: csvList(idSchema, MAX_FILTER_ITEMS),
	cardIds: csvList(idSchema, MAX_FILTER_ITEMS),
	categoryIds: csvList(idSchema, MAX_FILTER_ITEMS),
	sources: csvList(z.enum(TRANSACTION_SOURCES, "Origem inválida."), TRANSACTION_SOURCES.length),
	statuses: csvList(z.enum(TRANSACTION_STATUSES, "Situação inválida."), TRANSACTION_STATUSES.length),
	minCents: blankAsAbsent(filterCents("O valor mínimo")),
	maxCents: blankAsAbsent(filterCents("O valor máximo")),
};

interface FilterRange {
	from?: string | undefined;
	to?: string | undefined;
	minCents?: number | undefined;
	maxCents?: number | undefined;
}

/** Mensagem do primeiro problema entre intervalos (data inicial depois da final, mínimo maior que o máximo). */
export function transactionFilterRangeError(f: FilterRange): string | null {
	if (f.from !== undefined && f.to !== undefined && f.from > f.to) {
		return "A data inicial não pode ser depois da final.";
	}
	if (f.minCents !== undefined && f.maxCents !== undefined && f.minCents > f.maxCents) {
		return "O valor mínimo não pode ser maior que o máximo.";
	}
	return null;
}

/** `GET /v1/transactions/count`: só os filtros (o app mostra "Ver 42 lançamentos" antes de aplicar). */
export const transactionCountQuery = z.object(transactionFilterFields).superRefine((q, ctx) => {
	const message = transactionFilterRangeError(q);
	if (message) ctx.addIssue({ code: "custom", message });
});

export const transactionListQuery = z
	.object({
		cursor: z.string().min(1).max(200).optional(),
		limit: z.coerce
			.number("O limite deve ser um número.")
			.int("O limite deve ser inteiro.")
			.min(1, "O limite mínimo é 1.")
			.max(100, "O limite máximo é 100.")
			.default(50),
		...transactionFilterFields,
	})
	.superRefine((q, ctx) => {
		const message = transactionFilterRangeError(q);
		if (message) ctx.addIssue({ code: "custom", message });
	});
export type TransactionListQuery = z.infer<typeof transactionListQuery>;

export const pendingListQuery = z.object({
	limit: z.coerce
		.number("O limite deve ser um número.")
		.int("O limite deve ser inteiro.")
		.min(1, "O limite mínimo é 1.")
		.max(200, "O limite máximo é 200.")
		.default(100),
});

export const transactionDeleteQuery = z.object({
	scope: z.enum(["item", "group"], "Use scope=item ou scope=group.").default("item"),
});

// ----------------------------------------------------------- recorrências

export const recurrencePostBody = z
	.object({
		month: monthKeySchema,
		/** Padrão: o dia da recorrência no mês. */
		date: localDateSchema.optional(),
		/** Padrão: o valor da recorrência (a conta de luz varia). */
		amountCents: positiveCentsSchema.optional(),
	})
	.strict();
export type RecurrencePostBody = z.infer<typeof recurrencePostBody>;

// ---------------------------------------------------------------- resumo

/** `GET /v1/budgets/suggestion`: sugestão da Órbita, calculada pelo engine com o gasto dos últimos meses fechados. */
export const budgetSuggestionResponse = z.object({
	/** Quantos meses fechados foram olhados. */
	months: z.number().int(),
	/** Quantos deles tinham gasto e entraram na conta; 0 = sem histórico para sugerir. */
	monthsUsed: z.number().int(),
	totalCents: z.number().int(),
	/** Por id de categoria, em reais inteiros. */
	byCategory: z.record(z.string(), z.number().int()),
});
export type BudgetSuggestionResponse = z.infer<typeof budgetSuggestionResponse>;

/** "Marcar como paga": o valor (o que falta da fatura) é do engine; o cliente só diz de qual conta sai. */
export const invoicePayBody = z.object({ accountId: idSchema }).strict();
export type InvoicePayBody = z.infer<typeof invoicePayBody>;

export const installmentsQuery = z.object({ from: monthKeySchema.optional() });

const cents = z.number().int();

export const monthSummaryResponse = z.object({
	month: monthKeySchema,
	summary: z.object({
		spentCents: cents,
		incomeCents: cents,
		/** Aplicações do mês (investimentos): à parte; não entram em `spentCents` nem em `byCategory`. */
		investedCents: cents,
		/** Parte de `spentCents` que é estimativa (parcela da fatura que o banco ainda não lançou). */
		projectedCents: cents,
		refundCreditCents: cents,
		/** Por id de categoria. */
		byCategory: z.record(z.string(), cents),
	}),
	budgets: z.array(
		z.object({
			scope: z.string(),
			limitCents: nonNegativeCentsSchema,
			spentCents: cents,
			remainingCents: cents,
			/** `null` quando o limite é zero e há gasto (a razão seria infinita). */
			ratio: z.number().nullable(),
			overBudget: z.boolean(),
			/** Passou do percentual de aviso das preferências (calculado pelo engine). */
			alert: z.boolean(),
		}),
	),
	/** O percentual de aviso usado em `budgets[].alert`. */
	budgetAlertPercent: z.number().int(),
	/** `null` fora do mês atual ou sem orçamento total. */
	safeToSpend: z
		.object({ availableCents: cents, perDayCents: cents, remainingDays: z.number().int() })
		.nullable(),
	/** `null` fora do mês atual. */
	projection: z.object({ projectedCents: cents, lowConfidence: z.boolean() }).nullable(),
	pendingRecurring: z.object({ expenseCents: cents, incomeCents: cents }),
	refundCreditCents: cents,
});
export type MonthSummaryResponse = z.infer<typeof monthSummaryResponse>;

export const invoiceComposition = z.object({
	purchasesCents: cents,
	installmentsCents: cents,
	recurringCents: cents,
	refundsCents: cents,
	totalCents: cents,
});
export type InvoiceComposition = z.infer<typeof invoiceComposition>;
