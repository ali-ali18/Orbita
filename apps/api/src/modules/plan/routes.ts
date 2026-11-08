import { toLocalDate } from "@orbita/core";
import { applyIncomePlan, buildIncomePlan, fitBudgetLimits, restoreBudgets } from "@orbita/ledger";
import { createRateLimiter } from "@orbita/security";
import { budgetsRestoreBody, monthParam, planApplyBody, planQuery } from "@orbita/shared";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { ModuleDeps } from "../../http/module-deps.ts";
import { rateLimit } from "../../http/rate-limit.ts";
import type { AppEnv } from "../../http/require-device.ts";
import { validate } from "../../http/validate.ts";

/**
 * O plano da renda: `GET /v1/plan/:month` (do engine), `POST /v1/plan/:month/apply` (grava no orçamento, com
 * confirmação e o que valia antes para o Desfazer) e, para o orçamento, "Ajustar para caber" e o Desfazer.
 */
export function routes({ stores, now, requireDevice }: ModuleDeps) {
	// Só escrita é limitada: 60 por 10 minutos por aparelho.
	const limiter = createRateLimiter({ limit: 60, windowMs: 10 * 60_000, now: () => now().getTime() });
	const limitWrites = rateLimit(limiter, (c) => `plan:${c.get("device").id}`);
	const writesOnly = createMiddleware<AppEnv>(async (c, next) =>
		c.req.method === "GET" ? next() : limitWrites(c, next),
	);
	const today = () => toLocalDate(now());

	return new Hono<AppEnv>()
		.use("/v1/plan/*", requireDevice)
		.use("/v1/plan/*", writesOnly)
		.use("/v1/budgets/fit", requireDevice)
		.use("/v1/budgets/fit", writesOnly)
		.use("/v1/budgets/restore", requireDevice)
		.use("/v1/budgets/restore", writesOnly)
		.get("/v1/plan/:month", validate("param", monthParam), validate("query", planQuery), async (c) =>
			c.json(
				await buildIncomePlan(
					stores,
					c.req.valid("param").month,
					today(),
					c.req.valid("query").reservePercent,
				),
			),
		)
		.post(
			"/v1/plan/:month/apply",
			validate("param", monthParam),
			validate("json", planApplyBody),
			async (c) =>
				c.json(await applyIncomePlan(stores, c.req.valid("param").month, today(), c.req.valid("json"))),
		)
		.post("/v1/budgets/fit", async (c) => c.json(await fitBudgetLimits(stores, today())))
		.post("/v1/budgets/restore", validate("json", budgetsRestoreBody), async (c) => {
			await restoreBudgets(stores, c.req.valid("json").previous);
			return c.body(null, 204);
		});
}
