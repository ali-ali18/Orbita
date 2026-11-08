import { DEFAULT_CHAT_EFFORT, DEFAULT_CHAT_MODEL, DEFAULT_FAST_MODEL } from "@orbita/agents";
import { z } from "zod";

// `z.coerce.boolean()` transforma "false" em true; aqui só "true"/"false" valem.
const booleanString = (fallback: boolean) =>
	z
		.enum(["true", "false"], { error: 'Use "true" ou "false".' })
		.default(fallback ? "true" : "false")
		.transform((v) => v === "true");

const envSchema = z.object({
	DATABASE_URL: z.string().min(1, "Defina DATABASE_URL."),
	APP_SECRET: z.string().min(32, "APP_SECRET precisa de pelo menos 32 caracteres (openssl rand -base64 48)."),
	PORT: z.coerce.number().int().positive().default(3000),
	/** Gera e mostra no log um código de pareamento enquanto não houver aparelho. */
	PAIRING_AUTO: booleanString(true),
	/** Pasta com a atualização OTA assinada do app (gerada no CI e embutida na imagem). Ausente = sem atualização. */
	OTA_DIR: z.string().min(1).default("/app/ota"),
	/** Fila do Meu Pluggy (a mesma do worker). Sem isto, `POST /v1/pluggy/sync` responde 503. */
	REDIS_URL: z.string().min(1).optional(),
	/**
	 * Quantos proxies confiáveis há na frente: 0 = nenhum (usa o IP do socket),
	 * 1 = Traefik/Dokploy, 2 = Cloudflare + Traefik. Valor errado deixa forjar o IP.
	 */
	/** Modelo do chat (padrão em `@orbita/agents`). Troca de modelo = trocar esta variável, sem mexer no código. */
	CHAT_MODEL: z.string().min(1).default(DEFAULT_CHAT_MODEL),
	/** Modelo barato para perguntas curtas só de leitura; "off" desliga e manda tudo para `CHAT_MODEL`. */
	CHAT_MODEL_FAST: z.string().min(1).default(DEFAULT_FAST_MODEL),
	/** Quanto o modelo pensa: `low` (padrão), `medium` ou `high`. Mais esforço, mais custo. */
	CHAT_EFFORT: z
		.enum(["low", "medium", "high"], { error: "Use low, medium ou high." })
		.default(DEFAULT_CHAT_EFFORT),
	TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0, "Use um inteiro maior ou igual a 0.").default(0),
});
export type Env = z.infer<typeof envSchema>;

/** Lê e valida as variáveis de ambiente. Falha cedo, com a lista do que falta. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
	const parsed = envSchema.safeParse(source);
	if (!parsed.success) {
		const lines = parsed.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`);
		throw new Error(`Variáveis de ambiente inválidas:\n${lines.join("\n")}`);
	}
	return parsed.data;
}

/** Modelos do chat a partir das variáveis (`CHAT_MODEL_FAST=off` desliga a rota barata). */
export function chatModelsFromEnv(env: Pick<Env, "CHAT_MODEL" | "CHAT_MODEL_FAST" | "CHAT_EFFORT">) {
	return {
		main: env.CHAT_MODEL,
		fast: env.CHAT_MODEL_FAST.toLowerCase() === "off" ? null : env.CHAT_MODEL_FAST,
		effort: env.CHAT_EFFORT,
	};
}
