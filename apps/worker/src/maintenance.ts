import type { AuthStore, IdempotencyStore } from "@orbita/db";

export const MAINTENANCE_QUEUE = "manutencao";
export const CLEAN_PAIRING_CODES = "limpar-codigos-de-pareamento";
export const CLEAN_IDEMPOTENCY_KEYS = "limpar-chaves-de-idempotencia";
/** Códigos usados ou expirados há mais de um dia somem do banco. */
export const PAIRING_CODE_RETENTION_MS = 24 * 60 * 60_000;

export async function cleanPairingCodes(deps: {
	store: AuthStore;
	now: () => Date;
}): Promise<{ deleted: number }> {
	const before = new Date(deps.now().getTime() - PAIRING_CODE_RETENTION_MS);
	return { deleted: await deps.store.deleteStalePairingCodes(before) };
}

/** Chaves de idempotência já expiradas (a API trata como inexistentes) somem do banco. */
export async function cleanIdempotencyKeys(deps: {
	store: IdempotencyStore;
	now: () => Date;
}): Promise<{ deleted: number }> {
	return { deleted: await deps.store.deleteExpired(deps.now()) };
}
