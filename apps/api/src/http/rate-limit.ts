import type { RateLimiter } from "@orbita/security";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { apiError } from "./errors.ts";

/** Responde 429 com `Retry-After` (segundos) quando a chave estoura o limite. */
export function rateLimit(limiter: RateLimiter, keyOf: (c: Context) => string) {
	return createMiddleware(async (c, next) => {
		const hit = limiter.hit(keyOf(c));
		if (!hit.allowed) {
			const seconds = Math.max(1, Math.ceil(hit.retryAfterMs / 1000));
			c.header("Retry-After", String(seconds));
			return c.json(
				apiError("muitas_tentativas", "Muitas tentativas. Espere um pouco e tente de novo."),
				429,
			);
		}
		await next();
	});
}
