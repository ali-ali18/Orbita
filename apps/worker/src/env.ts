import { z } from "zod";

const envSchema = z.object({
	DATABASE_URL: z.string().min(1, "Defina DATABASE_URL."),
	REDIS_URL: z.string().min(1, "Defina REDIS_URL."),
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
