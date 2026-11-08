import { z } from "zod";
import { idSchema } from "./finance-primitives.ts";

/*
 * Perfil, preferências e notificações do celular. App de um dono só: um único registro de preferências no
 * servidor. Tudo aqui é configuração, nunca dado financeiro.
 */

export const DISPLAY_NAME_MAX = 40;
export const DEVICE_NAME_MAX = 60;

/** Como a Órbita chama o dono ("Olá, Alisson"). Espaços das pontas saem; vazio não vale (use `null` para limpar). */
export const displayNameSchema = z
	.string({ error: "Informe o nome." })
	.trim()
	.min(1, "Informe o nome.")
	.max(DISPLAY_NAME_MAX, `O nome tem até ${DISPLAY_NAME_MAX} letras.`);

export const deviceNameSchema = z
	.string({ error: "Informe o nome do aparelho." })
	.trim()
	.min(1, "Informe o nome do aparelho.")
	.max(DEVICE_NAME_MAX, `O nome do aparelho tem até ${DEVICE_NAME_MAX} letras.`);

/** `GET /v1/profile`. */
export const profileSchema = z.object({
	displayName: z.string().nullable(),
	deviceName: z.string(),
});
export type ProfileDto = z.infer<typeof profileSchema>;
export const profileResponse = z.object({ profile: profileSchema });
export type ProfileResponse = z.infer<typeof profileResponse>;

/** `PATCH /v1/profile`: só os campos enviados mudam. `displayName: null` volta ao tratamento sem nome. */
export const profilePatchBody = z
	.object({ displayName: displayNameSchema.nullable(), deviceName: deviceNameSchema })
	.partial()
	.strict()
	.refine((v) => Object.keys(v).length > 0, "Envie o que mudar.");
export type ProfilePatchBody = z.infer<typeof profilePatchBody>;

/** `GET /v1/preferences`. */
export const preferencesSchema = z.object({
	/** Conta que já vem marcada em "Novo lançamento"; `null` = sem preferência. */
	defaultAccountId: z.string().nullable(),
	/** Avisar quando o gasto passar deste percentual do limite (1 a 100). O push ainda não existe: vale para o indicador no app. */
	budgetAlertPercent: z.number().int().min(1).max(100),
	/** Conta que recebe a sobra do mês; `null` = nenhuma. Só a escolha é guardada, nenhum dinheiro é movido. */
	leftoverAccountId: z.string().nullable(),
	/** Ou uma meta ativa (nunca as duas ao mesmo tempo). Também só a escolha: nenhum dinheiro é movido. */
	leftoverGoalId: z.string().nullable(),
});
export type PreferencesDto = z.infer<typeof preferencesSchema>;
export const preferencesResponse = z.object({ preferences: preferencesSchema });
export type PreferencesResponse = z.infer<typeof preferencesResponse>;

export const preferencesPatchBody = z
	.object({
		defaultAccountId: idSchema.nullable(),
		budgetAlertPercent: z
			.number({ error: "Informe o percentual do aviso." })
			.int("O aviso vai de 1% a 100%.")
			.min(1, "O aviso vai de 1% a 100%.")
			.max(100, "O aviso vai de 1% a 100%."),
		leftoverAccountId: idSchema.nullable(),
		leftoverGoalId: idSchema.nullable(),
	})
	.partial()
	.strict()
	.refine((v) => Object.keys(v).length > 0, "Envie o que mudar.");
export type PreferencesPatchBody = z.infer<typeof preferencesPatchBody>;

/** Apps de banco que o dono pode escolher para a leitura de notificações (quando ela existir). */
export const NOTIFICATION_APPS = ["nubank", "inter", "santander", "mercadopago"] as const;
export type NotificationApp = (typeof NOTIFICATION_APPS)[number];
export const NOTIFICATION_APP_LABELS: Record<NotificationApp, string> = {
	nubank: "Nubank",
	inter: "Inter",
	santander: "Santander",
	mercadopago: "Mercado Pago",
};

export const notificationAppSchema = z.enum(NOTIFICATION_APPS, { error: "App de banco desconhecido." });

/**
 * `GET /v1/notification-settings`. São só as escolhas do dono: a captura das notificações do banco ainda não
 * existe, então `active` é sempre `false` até ela ser construída (o app avisa isso na tela).
 */
export const notificationSettingsSchema = z.object({
	capture: z.boolean(),
	apps: z.array(notificationAppSchema),
	toReview: z.boolean(),
	active: z.literal(false),
});
export type NotificationSettingsDto = z.infer<typeof notificationSettingsSchema>;
export const notificationSettingsResponse = z.object({ notifications: notificationSettingsSchema });
export type NotificationSettingsResponse = z.infer<typeof notificationSettingsResponse>;

export const notificationSettingsPatchBody = z
	.object({
		capture: z.boolean(),
		apps: z.array(notificationAppSchema).max(NOTIFICATION_APPS.length, "Apps demais."),
		toReview: z.boolean(),
	})
	.partial()
	.strict()
	.refine((v) => Object.keys(v).length > 0, "Envie o que mudar.");
export type NotificationSettingsPatchBody = z.infer<typeof notificationSettingsPatchBody>;
