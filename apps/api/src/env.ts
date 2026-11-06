import { z } from "zod";

const envSchema = z.object({
	DATABASE_URL: z.string().min(1, "Defina DATABASE_URL."),
	APP_SECRET: z.string().min(32, "APP_SECRET precisa de pelo menos 32 caracteres (openssl rand -base64 48)."),
	PORT: z.coerce.number().int().positive().default(3000),
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
