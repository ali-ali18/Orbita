import { createRateLimiter } from "@orbita/security";

/** Teto global de pedidos errados por hora, somando todos os IPs. */
export const PAIRING_FAILED_CLAIMS_LIMIT = 20;
export const PAIRING_FAILED_CLAIMS_WINDOW_MS = 60 * 60_000;

export type PairingGuardStatus = { paused: boolean; retryAfterMs: number };

/**
 * Orçamento global de palpites errados. O código tem 6 dígitos; sem este teto, um
 * atacante com muitos IPs teria um novo lote de palpites a cada código gerado.
 * Uma instância só, compartilhada pela rota e pelo laço do pareamento automático.
 */
export type PairingGuard = {
	status(): PairingGuardStatus;
	recordFailure(): void;
};

export function createPairingGuard(now: () => number): PairingGuard {
	const limiter = createRateLimiter({
		limit: PAIRING_FAILED_CLAIMS_LIMIT,
		windowMs: PAIRING_FAILED_CLAIMS_WINDOW_MS,
		now,
		maxKeys: 1,
	});
	const KEY = "falhas";
	return {
		status() {
			const res = limiter.peek(KEY);
			return { paused: !res.allowed, retryAfterMs: res.retryAfterMs };
		},
		recordFailure() {
			limiter.hit(KEY);
		},
	};
}
