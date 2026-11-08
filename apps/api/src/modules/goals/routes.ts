import { toLocalDate } from "@orbita/core";
import { DataError } from "@orbita/db";
import { createRateLimiter } from "@orbita/security";
import {
	goalContributionBody,
	goalContributionParam,
	goalCreateBody,
	goalUpdateBody,
	idParam,
} from "@orbita/shared";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { defined, orNotFound } from "../../http/errors.ts";
import type { ModuleDeps } from "../../http/module-deps.ts";
import { rateLimit } from "../../http/rate-limit.ts";
import type { AppEnv } from "../../http/require-device.ts";
import { validate } from "../../http/validate.ts";
import { type GoalClock, goalDetail, listGoals, toContributionDto } from "./service.ts";

/** Metas de guardar dinheiro: CRUD, "Guardar" (contribuição) e a lista com os números do engine. */
export function routes({ stores, now, requireDevice }: ModuleDeps) {
	const { goals } = stores;
	// Só escrita é limitada (ler a lista é o uso normal da tela): 120 por 10 minutos por aparelho.
	const limiter = createRateLimiter({ limit: 120, windowMs: 10 * 60_000, now: () => now().getTime() });
	const limitWrites = rateLimit(limiter, (c) => `goals:${c.get("device").id}`);
	const writesOnly = createMiddleware<AppEnv>(async (c, next) =>
		c.req.method === "GET" ? next() : limitWrites(c, next),
	);
	const clock = (): GoalClock => ({ today: toLocalDate(now()), dayOf: (d) => toLocalDate(d) });

	return (
		new Hono<AppEnv>()
			.use("/v1/goals", requireDevice)
			.use("/v1/goals/*", requireDevice)
			// O curinga também cobre `/v1/goals`: um pedido conta uma vez só.
			.use("/v1/goals/*", writesOnly)
			.get("/v1/goals", async (c) => c.json(await listGoals(stores, clock())))
			.post("/v1/goals", validate("json", goalCreateBody), async (c) => {
				const goal = await goals.create(defined(c.req.valid("json")));
				return c.json(orNotFound(await goalDetail(stores, goal.id, clock()), "Meta"), 201);
			})
			.get("/v1/goals/:id", validate("param", idParam), async (c) =>
				c.json(orNotFound(await goalDetail(stores, c.req.valid("param").id, clock()), "Meta")),
			)
			.patch("/v1/goals/:id", validate("param", idParam), validate("json", goalUpdateBody), async (c) => {
				const { id } = c.req.valid("param");
				await goals.update(id, defined(c.req.valid("json")));
				return c.json(orNotFound(await goalDetail(stores, id, clock()), "Meta"));
			})
			.delete("/v1/goals/:id", validate("param", idParam), async (c) => {
				const { id } = c.req.valid("param");
				await goals.archive(id);
				return c.json(orNotFound(await goalDetail(stores, id, clock()), "Meta"));
			})
			.post(
				"/v1/goals/:id/contributions",
				validate("param", idParam),
				validate("json", goalContributionBody),
				async (c) => {
					const { id } = c.req.valid("param");
					const { amountCents, date, transactionId } = c.req.valid("json");
					const today = toLocalDate(now());
					if (date !== undefined && date > today) {
						throw new DataError("invalid", "A data de quando guardou não pode ser no futuro.");
					}
					const contribution = await goals.addContribution(id, {
						amountCents,
						date: date ?? today,
						...(transactionId ? { transactionId } : {}),
					});
					const detail = orNotFound(await goalDetail(stores, id, clock()), "Meta");
					return c.json({ contribution: toContributionDto(contribution), goal: detail.goal }, 201);
				},
			)
			.delete(
				"/v1/goals/:id/contributions/:contributionId",
				validate("param", goalContributionParam),
				async (c) => {
					const { id, contributionId } = c.req.valid("param");
					await goals.removeContribution(id, contributionId);
					return c.json(orNotFound(await goalDetail(stores, id, clock()), "Meta"));
				},
			)
	);
}
