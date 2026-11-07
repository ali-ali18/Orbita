import { z } from "zod";

const envSchema = z.object({
	DATABASE_URL: z.string().min(1, "Defina DATABASE_URL."),
	REDIS_URL: z.string().min(1, "Defina REDIS_URL."),
	/** Abre o cofre das chaves (Pluggy). O mesmo segredo da API: a chave de cifra é derivada dele. */
	APP_SECRET: z.string().min(32, "APP_SECRET precisa de pelo menos 32 caracteres (openssl rand -base64 48)."),
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
