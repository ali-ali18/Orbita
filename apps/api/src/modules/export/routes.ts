import { createRateLimiter } from "@orbita/security";
import { exportQuery } from "@orbita/shared";
import { Hono } from "hono";
import type { ModuleDeps } from "../../http/module-deps.ts";
import { rateLimit } from "../../http/rate-limit.ts";
import type { AppEnv } from "../../http/require-device.ts";
import { validate } from "../../http/validate.ts";
import { buildExport } from "./service.ts";

/**
 * `GET /v1/export`: leva os dados embora (CSV ou JSON). Exige o aparelho pareado e tem teto por aparelho: montar o
 * arquivo lê todos os lançamentos, então um laço de pedidos não pode pesar no servidor.
 */
export function routes({ stores, now, requireDevice }: ModuleDeps) {
	const limiter = createRateLimiter({ limit: 10, windowMs: 10 * 60_000, now: () => now().getTime() });
	return new Hono<AppEnv>().get(
		"/v1/export",
		requireDevice,
		rateLimit(limiter, (c) => `export:${c.get("device").id}`),
		validate("query", exportQuery),
		async (c) => {
			const file = await buildExport({ stores, now }, c.req.valid("query"));
			// Dados financeiros: nada de cache no caminho. O nome do arquivo é só ASCII (montado aqui, sem entrada do usuário).
			c.header("Cache-Control", "no-store");
			c.header("Content-Disposition", `attachment; filename="${file.filename}"`);
			c.header("X-Content-Type-Options", "nosniff");
			return c.body(file.body, 200, { "Content-Type": file.contentType });
		},
	);
}
