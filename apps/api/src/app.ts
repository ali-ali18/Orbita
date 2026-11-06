import { zValidator } from "@hono/zod-validator";
import type { DeviceRecord } from "@orbita/db";
import { type PairingClaimResponse, pairingClaimBody } from "@orbita/shared";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { apiError, toDeviceDto } from "./http.ts";
import { authenticateDevice, claimPairingCode, type PairingDeps } from "./pairing/pairing.ts";

type AppEnv = { Variables: { device: DeviceRecord } };

export function createApp(deps: PairingDeps) {
	const requireDevice = createMiddleware<AppEnv>(async (c, next) => {
		const header = c.req.header("authorization") ?? "";
		const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
		const device = token ? await authenticateDevice(deps, token) : null;
		if (!device)
			return c.json(apiError("nao_autorizado", "Este aparelho não está conectado. Pareie de novo."), 401);
		c.set("device", device);
		await next();
	});

	const app = new Hono<AppEnv>()
		.get("/health", (c) => c.json({ ok: true }))
		.post(
			"/v1/pairing/claim",
			zValidator("json", pairingClaimBody, (result, c) => {
				if (!result.success) {
					return c.json(
						apiError("dados_invalidos", result.error.issues[0]?.message ?? "Dados inválidos."),
						400,
					);
				}
			}),
			async (c) => {
				const result = await claimPairingCode(deps, c.req.valid("json"));
				if (!result.ok) {
					return c.json(
						apiError("codigo_invalido", "Código inválido ou expirado. Gere outro no servidor com `parear`."),
						401,
					);
				}
				const body: PairingClaimResponse = { token: result.token, device: toDeviceDto(result.device) };
				return c.json(body, 201);
			},
		)
		.get("/v1/me", requireDevice, (c) => c.json({ device: toDeviceDto(c.get("device")) }))
		.delete("/v1/devices/current", requireDevice, async (c) => {
			await deps.store.revokeDevice({ deviceId: c.get("device").id, now: deps.now() });
			return c.body(null, 204);
		});

	app.notFound((c) => c.json(apiError("nao_encontrado", "Rota não encontrada."), 404));
	app.onError((err, c) => {
		console.error(err);
		return c.json(apiError("erro_interno", "Algo deu errado no servidor."), 500);
	});
	return app;
}

export type AppType = ReturnType<typeof createApp>;
