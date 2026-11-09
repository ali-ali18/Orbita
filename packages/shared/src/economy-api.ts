import { z } from "zod";
import { idSchema, timestampSchema } from "./finance-primitives.ts";

/*
 * Economia: a lista "Onde cortar" (achados do engine, com a economia mensal estimada), as ações de um toque e o
 * registro do que o agente fez sozinho, com o Desfazer. Todo número vem pronto do servidor (engine); o app só mostra.
 */

export const SAVINGS_CONFIDENCE_VALUES = ["high", "medium", "low"] as const;
export const SAVINGS_ACTION_IDS = ["cancel_reminder", "create_limit", "ignore"] as const;
export type SavingsActionId = (typeof SAVINGS_ACTION_IDS)[number];

/** Espelha `OPPORTUNITY_TYPES` e `AUTONOMOUS_ACTION_KINDS` de `@orbita/core` (um teste do servidor confere). */
export const OPPORTUNITY_TYPE_VALUES = [
	"duplicate_subscription",
	"price_increase",
	"category_above_average",
	"fees",
	"small_recurring",
	"installments_load",
	"projected_over",
	"invoice_unfunded",
] as const;
export const ACTIVITY_KIND_VALUES = [
	"categorize_transaction",
	"register_subscription",
	"set_budget_limit",
	"flag_duplicate",
	"create_savings_goal",
] as const;

export interface SavingsOpportunityDto {
	/** Estável entre execuções: é o que "Ignorar" e as ações mandam de volta. */
	key: string;
	type: (typeof OPPORTUNITY_TYPE_VALUES)[number];
	title: string;
	/** Texto pronto (números do engine já formatados). */
	body: string;
	/** Economia estimada por mês, em centavos inteiros (0 = um risco, não uma economia). */
	monthlySavingsCents: number;
	confidence: (typeof SAVINGS_CONFIDENCE_VALUES)[number];
	/** Entra no total "dá para cortar"? Falso nos que se sobrepõem a outros. */
	countsInTotal: boolean;
	evidenceTransactionIds: string[];
	/** As ações de um toque; `ignore` sempre está. */
	actions: Array<{ id: SavingsActionId; label: string }>;
}

export interface SavingsListResponse {
	month: string;
	totalMonthlySavingsCents: number;
	opportunities: SavingsOpportunityDto[];
	/** Quanto o agente Economia pode fazer sozinho (padrão: só avisar). */
	autonomy: "notify" | "reversible";
	agentId: string | null;
	agentEnabled: boolean;
}

export const savingsActBody = z
	.object({
		key: z.string().min(1).max(200),
		action: z.enum(["cancel_reminder", "create_limit"], { error: "Ação inválida." }),
	})
	.strict();
export type SavingsActBody = z.infer<typeof savingsActBody>;

export const savingsIgnoreBody = z.object({ key: z.string().min(1).max(200) }).strict();
export type SavingsIgnoreBody = z.infer<typeof savingsIgnoreBody>;

export const activityDtoSchema = z.object({
	id: idSchema,
	kind: z.enum(ACTIVITY_KIND_VALUES),
	/** O quê. */
	summary: z.string(),
	/** Por quê. */
	reason: z.string(),
	evidenceTransactionIds: z.array(z.string()),
	/** `applying`: a ação está sendo concluída (ainda não dá para desfazer). */
	status: z.enum(["applying", "done", "undone"]),
	createdAt: timestampSchema,
	undoneAt: timestampSchema.nullable(),
	/** Quando o Desfazer não mexeu em nada (o dono já tinha mudado), o porquê. */
	undoNote: z.string().nullable(),
	/** Ainda dá para desfazer (a ação está feita). */
	canUndo: z.boolean(),
});
export type ActivityDto = z.infer<typeof activityDtoSchema>;

export interface ActivityListResponse {
	activities: ActivityDto[];
}

export interface ActivityUndoResponse {
	activity: ActivityDto;
	/** `false` quando nada foi mexido porque o dono já tinha mudado o que o agente fez. */
	reverted: boolean;
	/** Frase pronta para o app mostrar. */
	message: string;
}

export const activityQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).optional() });
