import { z } from "zod";
import {
	ACCOUNT_KINDS,
	CLOSING_RULES,
	dayOfMonthSchema,
	idSchema,
	localDateSchema,
	monthKeySchema,
	nameSchema,
	nonNegativeCentsSchema,
	positiveCentsSchema,
	RECURRENCE_KINDS,
	TRANSACTION_KINDS,
	TRANSACTION_SOURCES,
	TRANSACTION_STATUSES,
	timestampSchema,
} from "./finance-primitives.ts";
import {
	DESCRIPTION_MAX,
	INCOME_ON_CARD_MESSAGE,
	NOTE_MAX,
	transactionInvariantError,
} from "./transaction-rules.ts";

const ispbSchema = z.string().regex(/^\d{8}$/, "O código do banco (ISPB) tem 8 números.");
const last4Schema = z.string().regex(/^\d{4}$/, "Informe os 4 últimos dígitos do cartão.");

// ---------------------------------------------------------------- contas

export const accountCreateBody = z
	.object({
		name: nameSchema,
		kind: z.enum(ACCOUNT_KINDS, "Tipo de conta inválido."),
		bankCode: ispbSchema.nullish(),
	})
	.strict();
export type AccountCreateBody = z.infer<typeof accountCreateBody>;

export const accountUpdateBody = accountCreateBody.partial();
export type AccountUpdateBody = z.infer<typeof accountUpdateBody>;

export const accountDto = z.object({
	id: idSchema,
	name: z.string(),
	kind: z.enum(ACCOUNT_KINDS),
	bankCode: z.string().nullable(),
	archivedAt: timestampSchema.nullable(),
	createdAt: timestampSchema,
	updatedAt: timestampSchema,
});
export type AccountDto = z.infer<typeof accountDto>;

// -------------------------------------------------------------- cartões

export const cardCreateBody = z
	.object({
		name: nameSchema,
		bankCode: ispbSchema.nullish(),
		last4: last4Schema.nullish(),
		closingDay: dayOfMonthSchema,
		dueDay: dayOfMonthSchema,
		// Sem `default`: o store decide (ausente = padrão com origem "default"; informada = escolha do dono).
		closingRule: z.enum(CLOSING_RULES, "Regra de fechamento inválida.").optional(),
		limitCents: nonNegativeCentsSchema.nullish(),
	})
	.strict();
export type CardCreateBody = z.infer<typeof cardCreateBody>;

/** Sem `default`: campo ausente no PATCH não vira "closing-day-next". */
export const cardUpdateBody = cardCreateBody
	.omit({ closingRule: true })
	.extend({ closingRule: z.enum(CLOSING_RULES, "Regra de fechamento inválida.") })
	.partial();
export type CardUpdateBody = z.infer<typeof cardUpdateBody>;

export const cardDto = z.object({
	id: idSchema,
	name: z.string(),
	bankCode: z.string().nullable(),
	last4: z.string().nullable(),
	closingDay: z.number().int(),
	dueDay: z.number().int(),
	closingRule: z.enum(CLOSING_RULES),
	limitCents: z.number().int().nullable(),
	archivedAt: timestampSchema.nullable(),
	createdAt: timestampSchema,
	updatedAt: timestampSchema,
});
export type CardDto = z.infer<typeof cardDto>;

// ------------------------------------------------------------ categorias

const slugSchema = z
	.string()
	.regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "O identificador usa letras minúsculas, números e hífen.")
	.max(40, "O identificador passa de 40 letras.");
const chartSlotSchema = z
	.number("O espaço no gráfico deve ser um número.")
	.int("O espaço no gráfico deve ser inteiro.")
	.min(0, "O espaço no gráfico vai de 0 a 9.")
	.max(9, "O espaço no gráfico vai de 0 a 9.");

export const categoryCreateBody = z
	.object({ slug: slugSchema, name: nameSchema, chartSlot: chartSlotSchema.nullish() })
	.strict();
export type CategoryCreateBody = z.infer<typeof categoryCreateBody>;

/** O slug não muda depois de criado. */
export const categoryUpdateBody = z
	.object({ name: nameSchema, chartSlot: chartSlotSchema.nullable() })
	.partial()
	.strict();
export type CategoryUpdateBody = z.infer<typeof categoryUpdateBody>;

export const categoryDto = z.object({
	id: idSchema,
	slug: z.string(),
	name: z.string(),
	chartSlot: z.number().int().nullable(),
	isSystem: z.boolean(),
	archivedAt: timestampSchema.nullable(),
});
export type CategoryDto = z.infer<typeof categoryDto>;

// ----------------------------------------------------------- lançamentos

export const descriptionSchema = z
	.string()
	.trim()
	.min(1, "Informe a descrição do lançamento.")
	.max(DESCRIPTION_MAX);
const noteSchema = z.string().max(NOTE_MAX, `A observação passa de ${NOTE_MAX} letras.`);

/** Campos de um lançamento; `finance-api.ts` monta os corpos da API (sem `invoiceMonth`) a partir daqui. */
export const transactionFields = {
	kind: z.enum(TRANSACTION_KINDS, "Tipo de lançamento inválido."),
	amountCents: positiveCentsSchema,
	date: localDateSchema,
	description: descriptionSchema,
	categoryId: idSchema.nullish(),
	accountId: idSchema.nullish(),
	cardId: idSchema.nullish(),
	counterpartAccountId: idSchema.nullish(),
	refundOfId: idSchema.nullish(),
	/** Sem ele vale o mês de `date` (parcelas informam o seu). */
	budgetMonth: monthKeySchema.nullish(),
	invoiceMonth: monthKeySchema.nullish(),
	status: z.enum(TRANSACTION_STATUSES, "Situação inválida.").optional(),
	note: noteSchema.nullish(),
};

/** Lançamento manual. Origem, id externo e parcelas são preenchidos pelo servidor. */
export const transactionCreateBody = z
	.object(transactionFields)
	.strict()
	.superRefine((t, ctx) => {
		const message = transactionInvariantError(t);
		if (message) ctx.addIssue({ code: "custom", message });
	});
export type TransactionCreateBody = z.infer<typeof transactionCreateBody>;

/** Cada campo ausente fica como está; `null` limpa (categoria, observação…). O servidor revalida o lançamento inteiro. */
export const transactionUpdateBody = z
	.object({
		...transactionFields,
		categoryId: idSchema.nullable(),
		accountId: idSchema.nullable(),
		cardId: idSchema.nullable(),
		counterpartAccountId: idSchema.nullable(),
		refundOfId: idSchema.nullable(),
		invoiceMonth: monthKeySchema.nullable(),
		note: noteSchema.nullable(),
	})
	.partial()
	.strict();
export type TransactionUpdateBody = z.infer<typeof transactionUpdateBody>;

export const transactionDto = z.object({
	id: idSchema,
	kind: z.enum(TRANSACTION_KINDS),
	amountCents: z.number().int(),
	date: localDateSchema,
	description: z.string(),
	categoryId: z.string().nullable(),
	accountId: z.string().nullable(),
	cardId: z.string().nullable(),
	counterpartAccountId: z.string().nullable(),
	refundOfId: z.string().nullable(),
	budgetMonth: monthKeySchema,
	invoiceMonth: monthKeySchema.nullable(),
	installmentGroupId: z.string().nullable(),
	installmentNumber: z.number().int().nullable(),
	installmentCount: z.number().int().nullable(),
	status: z.enum(TRANSACTION_STATUSES),
	source: z.enum(TRANSACTION_SOURCES),
	externalId: z.string().nullable(),
	note: z.string().nullable(),
	/** (A API sempre envia os três campos abaixo; `optional` só para não quebrar quem monta DTO à mão.)
	 * Categoria que o banco mandou (ex.: "Transfer - PIX", "Pai › Filha"); só de lançamentos importados. */
	sourceCategory: z.string().nullable().optional(),
	/** Nome do estabelecimento que o banco informou, quando informou. */
	merchantName: z.string().nullable().optional(),
	/** O dono trocou a categoria à mão: regras novas não a reclassificam. */
	categoryEditedByOwner: z.boolean().optional(),
	/** O dono mexeu no tipo, data, valor, conta ou cartão (ou revisou um pendente): a sincronização não o reescreve. */
	editedByOwner: z.boolean().optional(),
	/** Partes de uma compra dividida pelo dono dividem o mesmo grupo; `null` se não é parte de uma divisão. */
	splitGroupId: z.string().nullable().optional(),
	/**
	 * O banco ainda não efetivou (compra da fatura aberta do cartão, Pluggy `PENDING`). NÃO é "Para revisar" (`status`):
	 * conta no gasto normalmente; o app só mostra o rótulo "Pendente no banco".
	 */
	bankPending: z.boolean().optional(),
	createdAt: timestampSchema,
	updatedAt: timestampSchema,
});
export type TransactionDto = z.infer<typeof transactionDto>;

/** Paginação de `listRecent`: o cursor é o último item da página anterior. */
export const recentTransactionsQuery = z.object({
	limit: z.coerce
		.number()
		.int()
		.min(1, "O limite mínimo é 1.")
		.max(200, "O limite máximo é 200.")
		.default(50),
	beforeDate: localDateSchema.optional(),
	beforeId: idSchema.optional(),
});
export type RecentTransactionsQuery = z.infer<typeof recentTransactionsQuery>;

export const installmentGroupDto = z.object({
	groupId: idSchema,
	installments: z.array(transactionDto),
});
export type InstallmentGroupDto = z.infer<typeof installmentGroupDto>;

// ----------------------------------------------------------- recorrências

const recurrenceFields = {
	kind: z.enum(RECURRENCE_KINDS, "Tipo de recorrência inválido."),
	name: nameSchema,
	amountCents: positiveCentsSchema,
	dayOfMonth: dayOfMonthSchema,
	startDate: localDateSchema,
	endDate: localDateSchema.nullish(),
	categoryId: idSchema.nullish(),
	accountId: idSchema.nullish(),
	cardId: idSchema.nullish(),
	remindDayBefore: z.boolean("O lembrete deve ser verdadeiro ou falso.").optional(),
};

export const recurrenceCreateBody = z
	.object(recurrenceFields)
	.strict()
	.superRefine((r, ctx) => {
		if (Boolean(r.accountId) === Boolean(r.cardId))
			ctx.addIssue({ code: "custom", message: "Informe a conta ou o cartão (apenas um dos dois)." });
		if (r.kind === "income" && r.cardId) ctx.addIssue({ code: "custom", message: INCOME_ON_CARD_MESSAGE });
		if (r.endDate && r.endDate < r.startDate)
			ctx.addIssue({ code: "custom", message: "O fim não pode ser antes do início." });
	});
export type RecurrenceCreateBody = z.infer<typeof recurrenceCreateBody>;

export const recurrenceUpdateBody = z
	.object({
		...recurrenceFields,
		endDate: localDateSchema.nullable(),
		categoryId: idSchema.nullable(),
		accountId: idSchema.nullable(),
		cardId: idSchema.nullable(),
	})
	.partial()
	.strict();
export type RecurrenceUpdateBody = z.infer<typeof recurrenceUpdateBody>;

export const recurrenceDto = z.object({
	id: idSchema,
	kind: z.enum(RECURRENCE_KINDS),
	name: z.string(),
	amountCents: z.number().int(),
	dayOfMonth: z.number().int(),
	startDate: localDateSchema,
	endDate: localDateSchema.nullable(),
	categoryId: z.string().nullable(),
	accountId: z.string().nullable(),
	cardId: z.string().nullable(),
	remindDayBefore: z.boolean(),
	archivedAt: timestampSchema.nullable(),
	createdAt: timestampSchema,
	updatedAt: timestampSchema,
});
export type RecurrenceDto = z.infer<typeof recurrenceDto>;

export const recurrencePostingDto = z.object({
	recurrenceId: idSchema,
	month: monthKeySchema,
	transactionId: idSchema,
});
export type RecurrencePostingDto = z.infer<typeof recurrencePostingDto>;

// -------------------------------------------------------------- orçamento

/** "total" ou o id de uma categoria. */
export const budgetScopeSchema = z
	.string()
	.min(1, "Informe o escopo do orçamento.")
	.max(64, "Escopo inválido.");

export const budgetSetBody = z
	.object({ scope: budgetScopeSchema, limitCents: nonNegativeCentsSchema })
	.strict();
export type BudgetSetBody = z.infer<typeof budgetSetBody>;

export const budgetDto = z.object({
	scope: z.string(),
	limitCents: z.number().int(),
	updatedAt: timestampSchema,
});
export type BudgetDto = z.infer<typeof budgetDto>;
