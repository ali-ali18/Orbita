import type { ChatModelConfig } from "@orbita/agents";
import { describeModelError, type ModelClient } from "@orbita/agents";
import type { ChatConversationRecord, SecretVault } from "@orbita/db";
import { createRateLimiter } from "@orbita/security";
import {
	chatConversationRenameBody,
	chatConversationsQuery,
	chatRequestBody,
	idParam,
	proposalConfirmBody,
} from "@orbita/shared";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { apiError, orNotFound } from "../../http/errors.ts";
import type { ModuleDeps } from "../../http/module-deps.ts";
import { rateLimit } from "../../http/rate-limit.ts";
import type { AppEnv } from "../../http/require-device.ts";
import { validate } from "../../http/validate.ts";
import { decodeConversationCursor, encodeConversationCursor } from "./conversation-cursor.ts";
import {
	ChatPreconditionError,
	type ChatServiceDeps,
	cancelProposal,
	confirmProposal,
	hydrateMessages,
	preflightChat,
	runChatTurn,
	undoConfirmedProposal,
} from "./service.ts";

export type ChatRoutesDeps = ModuleDeps & {
	vault: SecretVault;
	createClient: (apiKey: string) => ModelClient;
	models: ChatModelConfig;
	/** Pedidos de chat por aparelho a cada 10 minutos (cada um pode custar dinheiro). */
	rateLimitPerWindow?: number;
};

const toConversationDto = (r: ChatConversationRecord) => ({
	id: r.id,
	title: r.title,
	updatedAt: r.updatedAt.toISOString(),
	agentId: r.agentId,
});

const RATE_WINDOW_MS = 10 * 60 * 1000;
export const DEFAULT_CHAT_RATE_LIMIT = 30;

/** Chat com a Órbita: resposta em SSE, histórico no servidor e as propostas de escrita (confirmar, cancelar, desfazer). */
export function routes(deps: ChatRoutesDeps) {
	const { stores, requireDevice } = deps;
	const service: ChatServiceDeps = {
		stores,
		vault: deps.vault,
		now: deps.now,
		createClient: deps.createClient,
		models: deps.models,
		logError: (message, error) => console.error(message, error),
	};
	const limiter = createRateLimiter({
		limit: deps.rateLimitPerWindow ?? DEFAULT_CHAT_RATE_LIMIT,
		windowMs: RATE_WINDOW_MS,
		now: () => deps.now().getTime(),
	});

	return new Hono<AppEnv>()
		.use("/v1/chat", requireDevice)
		.use("/v1/chat/*", requireDevice)
		.post(
			"/v1/chat",
			// O limite conta só quem chega a pedir IA (o corpo inválido nem gasta o limite).
			validate("json", chatRequestBody),
			rateLimit(limiter, (c) => c.get("device").id),
			async (c) => {
				const body = c.req.valid("json");
				let pre: Awaited<ReturnType<typeof preflightChat>>;
				try {
					pre = await preflightChat(service, body.conversationId, body.agentId, {
						setup: body.intent === "setup",
					});
				} catch (error) {
					if (error instanceof ChatPreconditionError) {
						return c.json(apiError(error.code, error.message), error.status);
					}
					throw error;
				}
				const profile = await stores.preferences.get();
				// Proxies (Traefik, nginx) seguram a resposta se acharem que ela pode ser guardada.
				c.header("X-Accel-Buffering", "no");
				c.header("Cache-Control", "no-cache, no-transform");
				return streamSSE(c, async (stream) => {
					const controller = new AbortController();
					stream.onAbort(() => controller.abort());
					const send = (event: unknown) => stream.writeSSE({ data: JSON.stringify(event) });
					try {
						const { messageId } = await runChatTurn(service, pre, {
							conversationId: body.conversationId,
							message: body.message,
							intent: body.intent,
							ownerName: profile.displayName,
							signal: controller.signal,
							emit: (event) => send(event),
						});
						await send({ type: "done", messageId });
					} catch (error) {
						if (controller.signal.aborted) return;
						const known =
							error instanceof Error &&
							(error.name === "DataError" || error.name === "ChatPreconditionError");
						if (!known) console.error("chat falhou", error);
						const info = known
							? { code: "erro_chat", message: (error as Error).message }
							: describeModelError(error);
						await send({ type: "error", code: info.code, message: info.message });
					}
				});
			},
		)
		.get("/v1/chat/conversations", validate("query", chatConversationsQuery), async (c) => {
			const { cursor, limit, q } = c.req.valid("query");
			const before = cursor === undefined ? undefined : decodeConversationCursor(cursor);
			// Pede um a mais só para saber se há outra página (o "Ver todas" da gaveta usa limit=3).
			const rows = await stores.chat.listConversations({
				limit: limit + 1,
				...(before ? { before } : {}),
				...(q ? { query: q } : {}),
			});
			const page = rows.slice(0, limit);
			const last = page.at(-1);
			return c.json({
				conversations: page.map(toConversationDto),
				nextCursor:
					rows.length > limit && last
						? encodeConversationCursor({ updatedAt: last.updatedAt, id: last.id })
						: null,
			});
		})
		.get("/v1/chat/conversations/:id", validate("param", idParam), async (c) => {
			const { id } = c.req.valid("param");
			const conversation = await stores.chat.getConversation(id);
			if (!conversation) return c.json(apiError("nao_encontrado", "Conversa não encontrada."), 404);
			const messages = await stores.chat.listMessages(id);
			return c.json({
				conversation: toConversationDto(conversation),
				messages: await hydrateMessages(service, messages),
			});
		})
		.patch(
			"/v1/chat/conversations/:id",
			validate("param", idParam),
			validate("json", chatConversationRenameBody),
			async (c) => {
				const renamed = await stores.chat.renameConversation(
					c.req.valid("param").id,
					c.req.valid("json").title,
				);
				return c.json({ conversation: toConversationDto(orNotFound(renamed, "Conversa")) });
			},
		)
		.delete("/v1/chat/conversations/:id", validate("param", idParam), async (c) =>
			c.json({ deleted: await stores.chat.deleteConversation(c.req.valid("param").id) }),
		)
		.post(
			"/v1/chat/proposals/:id/confirm",
			validate("param", idParam),
			// Corpo opcional: só a proposta de configuração leva o que o dono marcou e editou. Valor, dia e data nunca vêm daqui.
			validate("json", proposalConfirmBody),
			async (c) =>
				c.json({
					proposal: await confirmProposal(service, c.req.valid("param").id, c.req.valid("json").setup),
				}),
		)
		.post("/v1/chat/proposals/:id/cancel", validate("param", idParam), async (c) =>
			c.json({ proposal: await cancelProposal(service, c.req.valid("param").id) }),
		)
		.post("/v1/chat/proposals/:id/undo", validate("param", idParam), async (c) =>
			c.json({ proposal: await undoConfirmedProposal(service, c.req.valid("param").id) }),
		);
}
