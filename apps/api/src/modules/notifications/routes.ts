import { INBOX_MAX_AGE_DAYS, ingestNotification, retryNotificationInbox } from "@orbita/ingest";
import { createRateLimiter } from "@orbita/security";
import {
	idParam,
	type NotificationInboxResponse,
	type NotificationResult,
	notificationBatchBody,
} from "@orbita/shared";
import { Hono } from "hono";
import { orNotFound } from "../../http/errors.ts";
import type { ModuleDeps } from "../../http/module-deps.ts";
import { rateLimit } from "../../http/rate-limit.ts";
import type { AppEnv } from "../../http/require-device.ts";
import { validate } from "../../http/validate.ts";

/**
 * Notificações de banco lidas no aparelho (Android). O aparelho já filtrou por pacote e jogou fora código de
 * verificação; aqui tudo é conferido de novo, porque o texto vem de fora e nada dele é instrução. Ver
 * `@orbita/ingest` (`ingestNotification`) para as regras e docs/seguranca.md.
 */
export function routes({ stores, now, requireDevice }: ModuleDeps) {
	// Por aparelho: o lote tem até 10 notificações, então 60 pedidos a cada 10 minutos cobrem uma fila grande sem
	// deixar um laço de envios sobrecarregar o servidor.
	const limiter = createRateLimiter({ limit: 60, windowMs: 10 * 60_000, now: () => now().getTime() });
	// Tentar de novo percorre a lista toda: mais devagar que o envio.
	const retryLimiter = createRateLimiter({ limit: 10, windowMs: 10 * 60_000, now: () => now().getTime() });
	const deps = { stores, now };
	const purge = () =>
		stores.notificationInbox.purgeOlderThan(new Date(now().getTime() - INBOX_MAX_AGE_DAYS * 86_400_000));
	return new Hono<AppEnv>()
		.use("/v1/notifications", requireDevice)
		.use("/v1/notifications/*", requireDevice)
		.post(
			"/v1/notifications",
			rateLimit(limiter, (c) => c.get("device").id),
			validate("json", notificationBatchBody),
			async (c) => {
				const results: NotificationResult[] = [];
				// Uma de cada vez: a ordem do lote é a ordem em que o Android as registrou.
				for (const item of c.req.valid("json").items) {
					// Um item que falha não derruba os outros: o aparelho recebe o resultado de cada um.
					try {
						results.push(await ingestNotification(deps, item));
					} catch (error) {
						console.error(error);
						results.push("error");
					}
				}
				return c.json({ results });
			},
		)
		.get("/v1/notifications/inbox", async (c) => {
			await purge();
			const rows = await stores.notificationInbox.list();
			const body: NotificationInboxResponse = {
				items: rows.map((r) => ({
					id: r.id,
					app: r.app,
					title: r.title,
					text: r.text,
					reason: r.reason,
					postedAt: r.postedAt.toISOString(),
				})),
			};
			return c.json(body);
		})
		.post(
			"/v1/notifications/inbox/retry",
			rateLimit(retryLimiter, (c) => c.get("device").id),
			async (c) => {
				await purge();
				return c.json(await retryNotificationInbox(deps));
			},
		)
		.delete("/v1/notifications/inbox/:id", validate("param", idParam), async (c) => {
			orNotFound(
				(await stores.notificationInbox.remove(c.req.valid("param").id)) ? true : null,
				"Notificação",
			);
			return c.json({ ok: true as const });
		});
}
