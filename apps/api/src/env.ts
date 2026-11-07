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
	/**
	 * Quantos proxies confiáveis há na frente: 0 = nenhum (usa o IP do socket),
	 * 1 = Traefik/Dokploy, 2 = Cloudflare + Traefik. Valor errado deixa forjar o IP.
	 */
	/** Fila do Meu Pluggy (a mesma do worker). Sem isto, `POST /v1/pluggy/sync` responde 503. */
	REDIS_URL: z.string().min(1).optional(),
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
