import { z } from "zod";
import { descriptionSchema, transactionFields, transactionUpdateBody } from "./finance.ts";
import {
	idSchema,
	localDateSchema,
	MAX_INSTALLMENT_COUNT,
	monthKeySchema,
	nonNegativeCentsSchema,
	positiveCentsSchema,
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
const { invoiceMonth: _invoiceMonth, ...apiTransactionFields } = transactionFields;
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
	.omit({ invoiceMonth: true })
	.extend({ budgetMonth: monthKeySchema.optional() })
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

export const transactionListQuery = z.object({
	cursor: z.string().min(1).max(200).optional(),
	limit: z.coerce
		.number("O limite deve ser um número.")
		.int("O limite deve ser inteiro.")
		.min(1, "O limite mínimo é 1.")
		.max(100, "O limite máximo é 100.")
		.default(50),
});
export type TransactionListQuery = z.infer<typeof transactionListQuery>;

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

export const installmentsQuery = z.object({ from: monthKeySchema.optional() });

const cents = z.number().int();

export const monthSummaryResponse = z.object({
	month: monthKeySchema,
	summary: z.object({
		spentCents: cents,
		incomeCents: cents,
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
		}),
	),
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
