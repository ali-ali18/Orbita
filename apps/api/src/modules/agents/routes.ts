import { createRateLimiter } from "@orbita/security";
import { agentUpdateBody, alertsQuery, customAgentCreateBody, idParam } from "@orbita/shared";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { apiError, orNotFound } from "../../http/errors.ts";
import type { ModuleDeps } from "../../http/module-deps.ts";
import { rateLimit } from "../../http/rate-limit.ts";
import type { AppEnv } from "../../http/require-device.ts";
import { validate } from "../../http/validate.ts";
import { agentDetail, buildPatch, listAgents, toAlertDto } from "./service.ts";

/**
 * Agentes (da casa e do dono) e os avisos deles. Ligar, desligar e ajustar escolhas; criar, editar e apagar agente do
 * dono; listar, marcar como visto e dispensar avisos. Quem DECIDE os avisos é o worker (engine); aqui só se lê e se
 * guarda a vontade do dono. "Conversar com o agente" é o `POST /v1/chat` com `agentId`.
 */
export function routes({ stores, now, requireDevice }: ModuleDeps) {
	// Só escrita é limitada (ler é o uso normal das telas): 120 por 10 minutos por aparelho.
	const limiter = createRateLimiter({ limit: 120, windowMs: 10 * 60_000, now: () => now().getTime() });
	const limitWrites = rateLimit(limiter, (c) => `agents:${c.get("device").id}`);
	const writesOnly = createMiddleware<AppEnv>(async (c, next) =>
		c.req.method === "GET" ? next() : limitWrites(c, next),
	);
	const answerAlert = async (id: string, status: "seen" | "dismissed") => {
		const alert = orNotFound(await stores.agents.setAlertStatus(id, status), "Aviso", "o");
		const agent = await stores.agents.get(alert.agentId);
		return { alert: toAlertDto(alert, agent?.name ?? "Agente") };
	};
	const need = async (id: string) => orNotFound(await agentDetail(stores, id), "Agente", "o");

	return new Hono<AppEnv>()
		.use("/v1/agents", requireDevice)
		.use("/v1/agents/*", requireDevice)
		.use("/v1/alerts", requireDevice)
		.use("/v1/alerts/*", requireDevice)
		.use("/v1/agents/*", writesOnly)
		.use("/v1/alerts/*", writesOnly)
		.get("/v1/agents", async (c) => c.json({ agents: await listAgents(stores) }))
		.post("/v1/agents", validate("json", customAgentCreateBody), async (c) => {
			const body = c.req.valid("json");
			const agent = await stores.agents.createCustom({
				name: body.name,
				instructions: body.instructions,
				tools: body.tools,
				frequency: body.schedule.frequency,
				runHour: body.schedule.hour,
				runDay: body.schedule.day,
			});
			return c.json(await need(agent.id), 201);
		})
		.get("/v1/agents/:id", validate("param", idParam), async (c) =>
			c.json(await need(c.req.valid("param").id)),
		)
		.patch("/v1/agents/:id", validate("param", idParam), validate("json", agentUpdateBody), async (c) => {
			const { id } = c.req.valid("param");
			const agent = orNotFound(await stores.agents.get(id), "Agente", "o");
			await stores.agents.update(id, buildPatch(agent, c.req.valid("json")));
			return c.json(await need(id));
		})
		.delete("/v1/agents/:id", validate("param", idParam), async (c) => {
			// Agente da casa não se apaga (o store recusa com 400); o do dono leva os avisos junto.
			const deleted = await stores.agents.deleteCustom(c.req.valid("param").id);
			return deleted
				? c.json({ deleted: true })
				: c.json(apiError("nao_encontrado", "Agente não encontrado."), 404);
		})
		.get("/v1/alerts", validate("query", alertsQuery), async (c) => {
			const query = c.req.valid("query");
			const [alerts, agents] = await Promise.all([
				stores.agents.listAlerts({ status: query.status, agentId: query.agentId, limit: query.limit }),
				stores.agents.list(),
			]);
			const names = new Map(agents.map((a) => [a.id, a.name]));
			return c.json({ alerts: alerts.map((a) => toAlertDto(a, names.get(a.agentId) ?? "Agente")) });
		})
		.post("/v1/alerts/:id/seen", validate("param", idParam), async (c) =>
			c.json(await answerAlert(c.req.valid("param").id, "seen")),
		)
		.post("/v1/alerts/:id/dismiss", validate("param", idParam), async (c) =>
			c.json(await answerAlert(c.req.valid("param").id, "dismissed")),
		);
}
