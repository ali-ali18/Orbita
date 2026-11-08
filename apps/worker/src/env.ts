import { DEFAULT_CHAT_EFFORT, DEFAULT_CHAT_MODEL, DEFAULT_FAST_MODEL } from "@orbita/agents";
import { z } from "zod";

// Variável vazia (o compose repassa `""` quando o dono não definiu) vale como ausente.
const optional = <T extends z.ZodType>(schema: T) =>
	z.preprocess((value) => (value === "" ? undefined : value), schema);

const envSchema = z.object({
	DATABASE_URL: z.string().min(1, "Defina DATABASE_URL."),
	REDIS_URL: z.string().min(1, "Defina REDIS_URL."),
	/** Abre o cofre das chaves (Pluggy). O mesmo segredo da API: a chave de cifra é derivada dele. */
	APP_SECRET: z.string().min(32, "APP_SECRET precisa de pelo menos 32 caracteres (openssl rand -base64 48)."),
	/** Os mesmos padrões de modelo da API (o que o dono escolheu no app vence). */
	CHAT_MODEL: optional(z.string().min(1).default(DEFAULT_CHAT_MODEL)),
	CHAT_MODEL_FAST: optional(z.string().min(1).default(DEFAULT_FAST_MODEL)),
	CHAT_EFFORT: optional(
		z.enum(["low", "medium", "high"], { error: "Use low, medium ou high." }).default(DEFAULT_CHAT_EFFORT),
	),
	/** "false" desliga a reescrita dos avisos por IA: os avisos saem sempre com o texto-modelo. */
	AGENT_AI_WORDING: optional(
		z
			.enum(["true", "false"], { error: 'Use "true" ou "false".' })
			.default("true")
			.transform((v) => v === "true"),
	),
});
export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
	const parsed = envSchema.safeParse(source);
	if (!parsed.success) {
		const lines = parsed.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`);
		throw new Error(`Variáveis de ambiente inválidas:\n${lines.join("\n")}`);
	}
	return parsed.data;
}

/** Modelos padrão dos agentes a partir das variáveis (`CHAT_MODEL_FAST=off` desliga o modelo barato). */
export function chatModelsFromEnv(env: Pick<Env, "CHAT_MODEL" | "CHAT_MODEL_FAST" | "CHAT_EFFORT">) {
	return {
		main: env.CHAT_MODEL,
		fast: env.CHAT_MODEL_FAST.toLowerCase() === "off" ? null : env.CHAT_MODEL_FAST,
		effort: env.CHAT_EFFORT,
	};
}
