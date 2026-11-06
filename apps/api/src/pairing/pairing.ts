import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { AuthStore, DeviceRecord } from "@orbita/db";
import { PAIRING_CODE_LENGTH } from "@orbita/shared";

export const PAIRING_CODE_TTL_MS = 10 * 60_000;
export const PAIRING_MAX_ATTEMPTS = 5;
const TOKEN_PREFIX = "orb_";

export type PairingDeps = {
	store: AuthStore;
	secret: string;
	now: () => Date;
};

/** HMAC com o segredo do servidor: o banco nunca guarda o código em texto. */
export function hashPairingCode(secret: string, code: string): string {
	return createHmac("sha256", secret).update(code).digest("hex");
}

/** O token tem 256 bits de entropia, então um SHA-256 simples basta. */
export function hashDeviceToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

export function generatePairingCode(): string {
	return randomInt(0, 10 ** PAIRING_CODE_LENGTH)
		.toString()
		.padStart(PAIRING_CODE_LENGTH, "0");
}

export function generateDeviceToken(): string {
	return TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

function sameHash(a: string, b: string): boolean {
	const x = Buffer.from(a, "hex");
	const y = Buffer.from(b, "hex");
	return x.length === y.length && timingSafeEqual(x, y);
}

/** Gera um código novo (e invalida o anterior). Roda no servidor, pelo comando `parear`. */
export async function createPairingCode(deps: PairingDeps): Promise<{ code: string; expiresAt: Date }> {
	const now = deps.now();
	const code = generatePairingCode();
	const expiresAt = new Date(now.getTime() + PAIRING_CODE_TTL_MS);
	await deps.store.replaceActivePairingCode({ codeHash: hashPairingCode(deps.secret, code), expiresAt, now });
	return { code, expiresAt };
}

export type ClaimResult = { ok: true; token: string; device: DeviceRecord } | { ok: false };

/**
 * Troca o código digitado no app por um token do aparelho. Só existe um código
 * ativo; cada erro conta uma tentativa e, na quinta, o código morre.
 */
export async function claimPairingCode(
	deps: PairingDeps,
	input: { code: string; deviceName: string },
): Promise<ClaimResult> {
	const now = deps.now();
	const active = await deps.store.findActivePairingCode(now);
	if (!active) return { ok: false };

	if (!sameHash(hashPairingCode(deps.secret, input.code), active.codeHash)) {
		await deps.store.registerFailedAttempt({ codeId: active.id, maxAttempts: PAIRING_MAX_ATTEMPTS, now });
		return { ok: false };
	}

	const token = generateDeviceToken();
	const device = await deps.store.consumePairingCode({
		codeId: active.id,
		now,
		deviceName: input.deviceName,
		tokenHash: hashDeviceToken(token),
	});
	return device ? { ok: true, token, device } : { ok: false };
}

const TOUCH_INTERVAL_MS = 5 * 60_000;

/** Resolve o aparelho pelo token. Revogado ou desconhecido devolve `null`. */
export async function authenticateDevice(deps: PairingDeps, token: string): Promise<DeviceRecord | null> {
	if (!token.startsWith(TOKEN_PREFIX)) return null;
	const device = await deps.store.findDeviceByTokenHash(hashDeviceToken(token));
	if (!device || device.revokedAt) return null;
	const now = deps.now();
	// Atualiza "visto por último" no máximo a cada 5 minutos para não escrever a cada pedido.
	if (!device.lastSeenAt || now.getTime() - device.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
		await deps.store.touchDevice({ deviceId: device.id, now });
	}
	return device;
}
