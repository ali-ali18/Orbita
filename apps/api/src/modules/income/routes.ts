import { toLocalDate } from "@orbita/core";
import { incomeOverview, toIncomeSourceDto } from "@orbita/ledger";
import { createRateLimiter } from "@orbita/security";
import { idParam, incomeSourceCreateBody, incomeSourceUpdateBody } from "@orbita/shared";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { defined, orNotFound } from "../../http/errors.ts";
import type { ModuleDeps } from "../../http/module-deps.ts";
import { rateLimit } from "../../http/rate-limit.ts";
import type { AppEnv } from "../../http/require-device.ts";
import { validate } from "../../http/validate.ts";

/** Renda do dono: o salário e outras fontes. O que entra no mês e o próximo pagamento vêm do engine. */
export function routes({ stores, now, requireDevice }: ModuleDeps) {
	const { incomeSources } = stores;
	// Só escrita é limitada: 120 por 10 minutos por aparelho.
	const limiter = createRateLimiter({ limit: 120, windowMs: 10 * 60_000, now: () => now().getTime() });
	const limitWrites = rateLimit(limiter, (c) => `income:${c.get("device").id}`);
	const writesOnly = createMiddleware<AppEnv>(async (c, next) =>
		c.req.method === "GET" ? next() : limitWrites(c, next),
	);

	return new Hono<AppEnv>()
		.use("/v1/income", requireDevice)
		.use("/v1/income/*", requireDevice)
		.use("/v1/income/*", writesOnly)
		.get("/v1/income", async (c) => c.json(await incomeOverview(stores, toLocalDate(now()))))
		.post("/v1/income", validate("json", incomeSourceCreateBody), async (c) => {
			const created = await incomeSources.create(defined(c.req.valid("json")));
			return c.json({ source: toIncomeSourceDto(created) }, 201);
		})
		.patch(
			"/v1/income/:id",
			validate("param", idParam),
			validate("json", incomeSourceUpdateBody),
			async (c) => {
				const updated = await incomeSources.update(c.req.valid("param").id, defined(c.req.valid("json")));
				return c.json({ source: toIncomeSourceDto(updated) });
			},
		)
		.delete("/v1/income/:id", validate("param", idParam), async (c) => {
			const archived = await incomeSources.archive(c.req.valid("param").id);
			return c.json({ source: toIncomeSourceDto(orNotFound(archived, "Renda")) });
		});
}
