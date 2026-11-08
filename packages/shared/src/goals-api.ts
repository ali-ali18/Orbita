import { z } from "zod";
import {
	idSchema,
	localDateSchema,
	nameSchema,
	positiveCentsSchema,
	timestampSchema,
} from "./finance-primitives.ts";

/*
 * Metas de guardar dinheiro. A API devolve os números prontos (guardado, percentual, valor mensal, projeção,
 * situação): quem calcula é o engine (`@orbita/core`), nunca o app.
 */

/** Ícones de meta (nomes estáveis; o app escolhe o desenho). */
export const GOAL_ICONS = ["target", "plane", "shield", "monitor", "home", "car", "heart", "gift"] as const;
export type GoalIcon = (typeof GOAL_ICONS)[number];
export const DEFAULT_GOAL_ICON: GoalIcon = "target";

/** Cor da meta: índice em `chart.series` (0 a 9), a mesma paleta dos gráficos. */
export const GOAL_CHART_SLOTS = 10;

export const GOAL_STATUSES = ["reached", "no_deadline", "on_track", "behind"] as const;

export const goalIconSchema = z.enum(GOAL_ICONS, { error: "Ícone de meta inválido." });
export const goalChartSlotSchema = z
	.number({ error: "A cor da meta deve ser um número." })
	.int("A cor da meta deve ser um número inteiro.")
	.min(0, "A cor da meta vai de 0 a 9.")
	.max(GOAL_CHART_SLOTS - 1, "A cor da meta vai de 0 a 9.");

const goalFields = {
	name: nameSchema,
	targetCents: positiveCentsSchema,
	deadline: localDateSchema.nullish(),
	accountId: idSchema.nullish(),
	icon: goalIconSchema,
	chartSlot: goalChartSlotSchema,
};

export const goalCreateBody = z
	.object({ ...goalFields, icon: goalIconSchema.optional(), chartSlot: goalChartSlotSchema.optional() })
	.strict();
export type GoalCreateBody = z.infer<typeof goalCreateBody>;

/** Campo ausente fica como está; `null` limpa o prazo ou a conta. */
export const goalUpdateBody = z
	.object({ ...goalFields, deadline: localDateSchema.nullable(), accountId: idSchema.nullable() })
	.partial()
	.strict()
	.refine((v) => Object.keys(v).length > 0, "Envie o que mudar.");
export type GoalUpdateBody = z.infer<typeof goalUpdateBody>;

/** "Guardar": `date` é opcional (o servidor usa hoje) e não pode ser futura. */
export const goalContributionBody = z
	.object({
		amountCents: positiveCentsSchema,
		date: localDateSchema.optional(),
		transactionId: idSchema.nullish(),
	})
	.strict();
export type GoalContributionBody = z.infer<typeof goalContributionBody>;

export const goalContributionParam = z.object({ id: idSchema, contributionId: idSchema });

export const goalContributionDto = z.object({
	id: idSchema,
	goalId: idSchema,
	amountCents: z.number().int(),
	date: localDateSchema,
	transactionId: z.string().nullable(),
	createdAt: timestampSchema,
});
export type GoalContributionDto = z.infer<typeof goalContributionDto>;

export const goalDto = z.object({
	id: idSchema,
	name: z.string(),
	targetCents: z.number().int(),
	deadline: localDateSchema.nullable(),
	accountId: z.string().nullable(),
	icon: goalIconSchema,
	chartSlot: z.number().int(),
	archivedAt: timestampSchema.nullable(),
	createdAt: timestampSchema,
	updatedAt: timestampSchema,
	// Calculados pelo engine:
	savedCents: z.number().int(),
	remainingCents: z.number().int(),
	percent: z.number().int(),
	reached: z.boolean(),
	monthsLeft: z.number().int().nullable(),
	monthlyNeededCents: z.number().int().nullable(),
	paceCents: z.number().int(),
	projectedDate: localDateSchema.nullable(),
	status: z.enum(GOAL_STATUSES),
});
export type GoalDto = z.infer<typeof goalDto>;

/** `GET /v1/goals`: as metas ativas e o total guardado (para o cabeçalho). */
export const goalsListResponse = z.object({
	goals: z.array(goalDto),
	totals: z.object({ savedCents: z.number().int(), targetCents: z.number().int() }),
});
export type GoalsListResponse = z.infer<typeof goalsListResponse>;

/** `GET /v1/goals/:id`: a meta e as contribuições, da mais recente para a mais antiga. */
export const goalDetailResponse = z.object({
	goal: goalDto,
	contributions: z.array(goalContributionDto),
});
export type GoalDetailResponse = z.infer<typeof goalDetailResponse>;
