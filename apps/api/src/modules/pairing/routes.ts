import { zValidator } from "@hono/zod-validator";
import { createRateLimiter } from "@orbita/security";
import { type PairingClaimResponse, type PairingCodeResponse, pairingClaimBody } from "@orbita/shared";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { clientIp, ipRateLimitKey } from "../../http/client-ip.ts";
import { apiError } from "../../http/errors.ts";
import { rateLimit } from "../../http/rate-limit.ts";
import { type AppEnv, createRequireDevice } from "../../http/require-device.ts";
import { toDeviceDto } from "../devices/dto.ts";
import type { PairingGuard } from "./guard.ts";
import { claimPairingCode, createPairingCode, type PairingDeps } from "./service.ts";

export type PairingRoutesDeps = PairingDeps & {
	/** Quantos proxies confiáveis há na frente (0 = nenhum). Ver `resolveClientIp`. */
	trustedProxyHops: number;
	guard: PairingGuard;
};

export function routes(deps: PairingRoutesDeps) {
	const requireDevice = createRequireDevice(deps);
	const now = () => deps.now().getTime();
	// Por IP: segura quem tenta adivinhar o código. Por aparelho: segura convites em massa.
	const claimLimiter = createRateLimiter({ limit: 10, windowMs: 10 * 60_000, now });
	const inviteLimiter = createRateLimiter({ limit: 5, windowMs: 60 * 60_000, now });

	return new Hono<AppEnv>()
		.post(
			"/v1/pairing/claim",
			// Antes de qualquer coisa (e do banco): orçamento global de palpites errados.
			createMiddleware(async (c, next) => {
				const { paused, retryAfterMs } = deps.guard.status();
				if (!paused) return next();
				c.header("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
				return c.json(
					apiError(
						"muitas_tentativas",
						"O pareamento está pausado por um tempo, por segurança, depois de muitas tentativas erradas. Tente de novo mais tarde.",
					),
					429,
				);
			}),
			rateLimit(claimLimiter, (c) => ipRateLimitKey(clientIp(c, deps.trustedProxyHops))),
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
					// Só palpite errado de verdade conta no guard global; sem código ativo ou sem
					// tentativa sobrando, lixo na rota não pode travar o pareamento de todos.
					// O limite por IP continua valendo para qualquer resposta.
					if (result.reason === "mismatch") deps.guard.recordFailure();
					return c.json(
						apiError(
							"codigo_invalido",
							"Código inválido ou expirado. Gere outro no servidor com `parear` ou em um aparelho já conectado.",
						),
						401,
					);
				}
				const body: PairingClaimResponse = { token: result.token, device: toDeviceDto(result.device) };
				return c.json(body, 201);
			},
		)
		.post(
			"/v1/pairing/codes",
			requireDevice,
			rateLimit(inviteLimiter, (c) => c.get("device").id),
			async (c) => {
				const { code, expiresAt } = await createPairingCode(deps);
				const body: PairingCodeResponse = { code, expiresAt: expiresAt.toISOString() };
				return c.json(body, 201);
			},
		);
}
