import { undoActivity } from "@orbita/ledger";
import { createRateLimiter } from "@orbita/security";
import {
	type ActivityListResponse,
	type ActivityUndoResponse,
	activityQuery,
	idParam,
	savingsActBody,
	savingsIgnoreBody,
} from "@orbita/shared";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { apiError } from "../../http/errors.ts";
import type { ModuleDeps } from "../../http/module-deps.ts";
import { rateLimit } from "../../http/rate-limit.ts";
import type { AppEnv } from "../../http/require-device.ts";
import { validate } from "../../http/validate.ts";
import {
	actOnOpportunity,
	ignoreOpportunity,
	loadSavingsList,
	needEconomyAgent,
	toActivityDto,
} from "./service.ts";

/**
 * Economia: a lista "Onde cortar" (calculada na hora pelo engine), as ações de um toque do dono e o registro do que o
 * agente fez sozinho, com o Desfazer. Quem age sozinho é o worker; aqui o dono só lê, ignora, toca numa ação ou desfaz.
 */
export function routes({ stores, now, requireDevice }: ModuleDeps) {
	// Só escrita é limitada (ler é o uso normal das telas): 120 por 10 minutos por aparelho.
	const limiter = createRateLimiter({ limit: 120, windowMs: 10 * 60_000, now: () => now().getTime() });
	const limitWrites = rateLimit(limiter, (c) => `economy:${c.get("device").id}`);
	const writesOnly = createMiddleware<AppEnv>(async (c, next) =>
		c.req.method === "GET" ? next() : limitWrites(c, next),
	);

	return new Hono<AppEnv>()
		.use("/v1/savings", requireDevice)
		.use("/v1/savings/*", requireDevice)
		.use("/v1/agent-activity", requireDevice)
		.use("/v1/agent-activity/*", requireDevice)
		.use("/v1/savings/*", writesOnly)
		.use("/v1/agent-activity/*", writesOnly)
		.get("/v1/savings", async (c) => c.json(await loadSavingsList(stores, now)))
		.post("/v1/savings/ignore", validate("json", savingsIgnoreBody), async (c) => {
			await ignoreOpportunity(stores, c.req.valid("json").key);
			return c.json(await loadSavingsList(stores, now));
		})
		.post("/v1/savings/act", validate("json", savingsActBody), async (c) => {
			await actOnOpportunity(stores, now, c.req.valid("json"));
			return c.json(await loadSavingsList(stores, now));
		})
		.get("/v1/agent-activity", validate("query", activityQuery), async (c) => {
			const agent = await needEconomyAgent(stores);
			const rows = await stores.agentActivity.list({ agentId: agent.id, limit: c.req.valid("query").limit });
			// `retry` é só o contador entre tentativas: não aparece para o dono.
			return c.json({
				activities: rows.filter((a) => a.status !== "retry").map(toActivityDto),
			} satisfies ActivityListResponse);
		})
		.post("/v1/agent-activity/:id/undo", validate("param", idParam), async (c) => {
			try {
				const { activity, reverted } = await undoActivity(stores, c.req.valid("param").id);
				return c.json({
					activity: toActivityDto(activity),
					reverted,
					message: reverted ? "Desfeito." : (activity.undoNote ?? "Nada a desfazer."),
				} satisfies ActivityUndoResponse);
			} catch (error) {
				// Dois toques seguidos: o segundo leva 409 (a primeira chamada já desfez).
				if (error instanceof Error && "code" in error && error.code === "duplicate") {
					return c.json(apiError("ja_desfeito", "Esta atividade já foi desfeita."), 409);
				}
				throw error;
			}
		});
}
