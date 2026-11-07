import { z } from "zod";

/*
 * Tela "Servidor e chaves". O app cola a chave, o servidor guarda cifrada. A API nunca devolve o valor
 * nem parte dele (nem os últimos caracteres): só diz se está configurada e quando mudou.
 */

/** Nomes fixos, na ordem em que a API lista. */
export const SECRET_NAMES = ["anthropic_api_key", "pluggy_client_id", "pluggy_client_secret"] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

export const isSecretName = (value: string): value is SecretName =>
	(SECRET_NAMES as readonly string[]).includes(value);

export const secretNameSchema = z.enum(SECRET_NAMES, { error: "Chave desconhecida." });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Rule = { test: (value: string) => boolean; message: string };

// As mensagens nunca citam o valor digitado.
const RULES: Record<SecretName, Rule> = {
	anthropic_api_key: {
		test: (v) => /^sk-ant-[A-Za-z0-9_-]+$/.test(v) && v.length >= 20 && v.length <= 300,
		message:
			'A chave da Anthropic começa com "sk-ant-" e tem de 20 a 300 caracteres (letras, números, "-" e "_").',
	},
	pluggy_client_id: {
		test: (v) => UUID.test(v),
		message: "O Client ID do Pluggy é um código no formato 00000000-0000-0000-0000-000000000000.",
	},
	pluggy_client_secret: {
		test: (v) => UUID.test(v) || /^[A-Za-z0-9_-]{8,200}$/.test(v),
		message: 'O Client Secret do Pluggy tem de 8 a 200 caracteres (letras, números, "-" e "_").',
	},
};

export const SECRET_LABELS: Record<SecretName, string> = {
	anthropic_api_key: "Chave da Anthropic",
	pluggy_client_id: "Client ID do Pluggy",
	pluggy_client_secret: "Client Secret do Pluggy",
};

/** Corpo de `PUT /v1/settings/secrets/:name`. O formato depende do nome; veja `parseSecretValue`. */
export const secretPutBody = z
	.object({ value: z.string({ error: "Informe o valor da chave." }).max(1000, "O valor é grande demais.") })
	.strict();
export type SecretPutBody = z.infer<typeof secretPutBody>;

export type SecretValueResult = { ok: true; value: string } | { ok: false; message: string };

/** Tira espaços das pontas e confere o formato da chave. Rejeita com mensagem em pt-BR sem ecoar o valor. */
export function parseSecretValue(name: SecretName, raw: string): SecretValueResult {
	const value = raw.trim();
	if (!value) return { ok: false, message: "Informe o valor da chave." };
	const rule = RULES[name];
	return rule.test(value) ? { ok: true, value } : { ok: false, message: rule.message };
}

export const secretStatusSchema = z.object({
	name: secretNameSchema,
	configured: z.boolean(),
	/** ISO 8601; `null` quando não configurada. */
	updatedAt: z.string().nullable(),
});
export type SecretStatusDto = z.infer<typeof secretStatusSchema>;

/** `GET /v1/settings/secrets`: sempre as 3 chaves, na ordem de `SECRET_NAMES`. */
export const secretsListResponse = z.object({ secrets: z.array(secretStatusSchema) });
export type SecretsListResponse = z.infer<typeof secretsListResponse>;

/** `PUT` e `DELETE /v1/settings/secrets/:name`. */
export const secretResponse = z.object({ secret: secretStatusSchema });
export type SecretResponse = z.infer<typeof secretResponse>;

/** `GET /v1/server`: versão do servidor e o aparelho que está perguntando. */
export const serverInfoResponse = z.object({
	version: z.string(),
	device: z.object({ name: z.string(), pairedAt: z.string() }),
});
export type ServerInfoResponse = z.infer<typeof serverInfoResponse>;
