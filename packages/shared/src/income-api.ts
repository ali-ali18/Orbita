import { z } from "zod";
import {
	dayOfMonthSchema,
	idSchema,
	localDateSchema,
	monthKeySchema,
	nameSchema,
	positiveCentsSchema,
	timestampSchema,
} from "./finance-primitives.ts";

/*
 * Renda (salário e outras fontes) e o plano do mês feito a partir dela. Os números do plano vêm do engine
 * (`incomePlan` em `@orbita/core`); o app só mostra.
 */

const incomeFields = {
	name: nameSchema,
	amountCents: positiveCentsSchema,
	/** Dia do mês (1 a 31); em mês curto cai no último dia. */
	payday: dayOfMonthSchema,
	/** Conta onde o dinheiro cai (opcional). */
	accountId: idSchema.nullish(),
	/** `true` = todo mês (salário). `false` = só no `month` (um freela). */
	recurring: z.boolean(),
	/** Mês de uma fonte avulsa; ignorado (vira nulo) nas recorrentes. */
	month: monthKeySchema.nullish(),
};

export const incomeSourceCreateBody = z
	.object({ ...incomeFields, recurring: incomeFields.recurring.default(true) })
	.strict()
	.refine((v) => v.recurring || (v.month !== undefined && v.month !== null), {
		message: "Informe o mês da renda avulsa.",
		path: ["month"],
	});
export type IncomeSourceCreateBody = z.infer<typeof incomeSourceCreateBody>;

export const incomeSourceUpdateBody = z
	.object({ ...incomeFields, accountId: idSchema.nullable(), month: monthKeySchema.nullable() })
	.partial()
	.strict()
	.refine((v) => Object.keys(v).length > 0, "Envie o que mudar.");
export type IncomeSourceUpdateBody = z.infer<typeof incomeSourceUpdateBody>;

export const incomeSourceDto = z.object({
	id: idSchema,
	name: z.string(),
	amountCents: z.number().int(),
	payday: z.number().int(),
	accountId: z.string().nullable(),
	recurring: z.boolean(),
	month: monthKeySchema.nullable(),
	archivedAt: timestampSchema.nullable(),
	createdAt: timestampSchema,
	updatedAt: timestampSchema,
});
export type IncomeSourceDto = z.infer<typeof incomeSourceDto>;

/** `GET /v1/income`: as fontes ativas, o que entra neste mês e o próximo pagamento (do engine). */
export const incomeListResponse = z.object({
	sources: z.array(incomeSourceDto),
	/** Renda do mês corrente (recorrentes + avulsas do mês). */
	monthIncomeCents: z.number().int(),
	nextPayday: z.object({ sourceId: idSchema, date: localDateSchema, daysUntil: z.number().int() }).nullable(),
});
export type IncomeListResponse = z.infer<typeof incomeListResponse>;

// ------------------------------------------------------------------- plano

export const DEFAULT_PLAN_RESERVE_PERCENT = 10;

const reservePercentSchema = z
	.number("A reserva deve ser um número.")
	.int("A reserva deve ser um número inteiro.")
	.min(0, "A reserva vai de 0% a 100%.")
	.max(100, "A reserva vai de 0% a 100%.");

/** `GET /v1/plan/:month?reservePercent=10`. */
export const planQuery = z.object({
	reservePercent: z.coerce
		.number()
		.int("A reserva deve ser um número inteiro.")
		.min(0, "A reserva vai de 0% a 100%.")
		.max(100, "A reserva vai de 0% a 100%.")
		.optional(),
});

/** `POST /v1/plan/:month/apply`. `confirm` autoriza trocar ou remover limites que o dono já definiu. */
export const planApplyBody = z
	.object({ reservePercent: reservePercentSchema.optional(), confirm: z.boolean().optional() })
	.strict();
export type PlanApplyBody = z.infer<typeof planApplyBody>;

const cents = z.number().int();

export const PLAN_WARNING_CODES = [
	"no_income",
	"no_history",
	"commitments_exceed_income",
	"plan_exceeds_income",
	"scaled_to_fit",
] as const;

export const planDto = z.object({
	month: monthKeySchema,
	incomeCents: cents,
	reservePercent: z.number().int(),
	/** `false` quando só os compromissos já passam da renda (ou não há renda): não há plano para aplicar. */
	feasible: z.boolean(),
	buckets: z.object({
		commitmentsCents: cents,
		dailyCents: cents,
		goalsCents: cents,
		reserveCents: cents,
		leftCents: cents,
	}),
	commitments: z.array(
		z.object({
			id: z.string(),
			name: z.string(),
			categoryId: z.string().nullable(),
			amountCents: cents,
			source: z.enum(["recurrence", "installment", "fixed_budget"]),
		}),
	),
	goals: z.array(z.object({ id: idSchema, name: z.string(), amountCents: cents })),
	categories: z.array(
		z.object({
			categoryId: z.string(),
			name: z.string(),
			commitmentsCents: cents,
			dailyCents: cents,
			totalCents: cents,
		}),
	),
	budget: z.object({ totalCents: cents, byCategory: z.record(z.string(), cents) }),
	cut: z.object({ wantedCents: cents, capCents: cents }).nullable(),
	monthsUsed: z.number().int(),
	warnings: z.array(z.object({ code: z.enum(PLAN_WARNING_CODES), message: z.string(), amountCents: cents })),
	/** Quantos limites que o dono já definiu seriam trocados ou removidos ao aplicar. */
	replacesCount: z.number().int(),
});
export type PlanDto = z.infer<typeof planDto>;

/** Valor de um escopo do orçamento antes da mudança; `null` = não existia (desfazer apaga). */
export const budgetBefore = z.object({ scope: idSchema, limitCents: cents.nullable() });
export type BudgetBefore = z.infer<typeof budgetBefore>;

/** `POST /v1/plan/:month/apply` e `POST /v1/budgets/fit`: o que valia antes, para o Desfazer. */
export const budgetsChangeResponse = z.object({
	budgets: z.array(z.object({ scope: z.string(), limitCents: cents, updatedAt: timestampSchema })),
	previous: z.array(budgetBefore),
});
export type BudgetsChangeResponse = z.infer<typeof budgetsChangeResponse>;

/** `POST /v1/budgets/restore`: devolve os limites ao que eram (o Desfazer). */
export const budgetsRestoreBody = z.object({ previous: z.array(budgetBefore).max(100) }).strict();
export type BudgetsRestoreBody = z.infer<typeof budgetsRestoreBody>;
