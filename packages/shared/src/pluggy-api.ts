import { z } from "zod";
import { timestampSchema } from "./finance-primitives.ts";

/*
 * Meu Pluggy. O plano pessoal não lista conexões pela API: o dono cola o ID de cada conexão (itemId) uma vez.
 * Nenhuma resposta daqui carrega chave, token ou segredo; só o estado.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O itemId do Pluggy é um UUID. Minúsculo no banco, para não haver duas conexões "iguais". */
export const pluggyItemIdSchema = z
	.string("Informe o ID da conexão.")
	.trim()
	.regex(UUID, "O ID da conexão é um código no formato 00000000-0000-0000-0000-000000000000.")
	.transform((v) => v.toLowerCase());

export const PLUGGY_LABEL_MAX = 60;

/** Resultado da última sincronização de uma conexão. */
export const PLUGGY_SYNC_STATUSES = ["ok", "partial", "error", "no_keys"] as const;
export type PluggySyncStatus = (typeof PLUGGY_SYNC_STATUSES)[number];

export const pluggyConnectionCreateBody = z
	.object({
		itemId: pluggyItemIdSchema,
		label: z
			.string()
			.trim()
			.min(1, "Informe um nome.")
			.max(PLUGGY_LABEL_MAX, "O nome passa de 60 letras.")
			.nullish(),
	})
	.strict();
export type PluggyConnectionCreateBody = z.infer<typeof pluggyConnectionCreateBody>;

export const pluggyConnectionIdParam = z.object({ id: pluggyItemIdSchema });

export const pluggyConnectionDto = z.object({
	id: z.string(),
	label: z.string().nullable(),
	createdAt: timestampSchema,
	lastSyncAt: timestampSchema.nullable(),
	lastStatus: z.enum(PLUGGY_SYNC_STATUSES).nullable(),
	lastError: z.string().nullable(),
});
export type PluggyConnectionDto = z.infer<typeof pluggyConnectionDto>;

export const pluggyConnectionsResponse = z.object({ connections: z.array(pluggyConnectionDto) });
export const pluggyConnectionResponse = z.object({ connection: pluggyConnectionDto });

/** `GET /v1/pluggy/status`. */
export const pluggyStatusResponse = z.object({
	/** Client ID e Client Secret cadastrados (e legíveis com o `APP_SECRET` atual). */
	keysConfigured: z.boolean(),
	/** "idle" nada a fazer; "queued" esperando o worker; "running" sincronizando agora; "unavailable" sem fila (Redis). */
	sync: z.enum(["idle", "queued", "running", "unavailable"]),
	/** Início da sincronização mais antiga entre as conexões (o dado mais velho que o app tem); `null` se nenhuma terminou. */
	lastSyncAt: timestampSchema.nullable(),
	connections: z.array(pluggyConnectionDto),
});
export type PluggyStatusResponse = z.infer<typeof pluggyStatusResponse>;

/** `POST /v1/pluggy/sync` (202). */
export const pluggySyncResponse = z.object({ sync: z.enum(["queued", "running"]) });
export type PluggySyncResponse = z.infer<typeof pluggySyncResponse>;
