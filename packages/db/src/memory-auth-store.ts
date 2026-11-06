import { randomUUID } from "node:crypto";
import type { AuthStore, DeviceRecord, PairingCodeRecord } from "./auth-store.ts";

/** Implementação em memória, para testes. Segue as mesmas regras da versão Prisma. */
export function createMemoryAuthStore(): AuthStore & {
	codes: PairingCodeRecord[];
	devices: DeviceRecord[];
} {
	const codes: PairingCodeRecord[] = [];
	const devices: DeviceRecord[] = [];
	const isActive = (c: PairingCodeRecord, now: Date) => c.usedAt === null && c.expiresAt > now;

	return {
		codes,
		devices,
		async replaceActivePairingCode({ codeHash, expiresAt, now }) {
			for (const c of codes) if (isActive(c, now)) c.expiresAt = now;
			const code: PairingCodeRecord = { id: randomUUID(), codeHash, expiresAt, attempts: 0, usedAt: null };
			codes.push(code);
			return { ...code };
		},
		async findActivePairingCode(now, maxAttempts) {
			const active = codes.filter((c) => isActive(c, now) && c.attempts < maxAttempts).at(-1);
			return active ? { ...active } : null;
		},
		async reserveAttempt({ codeId, maxAttempts, now }) {
			const code = codes.find((c) => c.id === codeId);
			if (!code || !isActive(code, now) || code.attempts >= maxAttempts) return false;
			code.attempts += 1;
			return true;
		},
		async consumePairingCode({ codeId, now, deviceName, tokenHash }) {
			const code = codes.find((c) => c.id === codeId);
			if (!code || !isActive(code, now)) return null;
			code.usedAt = now;
			const device: DeviceRecord = {
				id: randomUUID(),
				name: deviceName,
				tokenHash,
				createdAt: now,
				lastSeenAt: now,
				revokedAt: null,
			};
			devices.push(device);
			return { ...device };
		},
		async findDeviceByTokenHash(tokenHash) {
			const d = devices.find((x) => x.tokenHash === tokenHash);
			return d ? { ...d } : null;
		},
		async touchDevice({ deviceId, now }) {
			const d = devices.find((x) => x.id === deviceId);
			if (d) d.lastSeenAt = now;
		},
		async revokeDevice({ deviceId, now }) {
			const d = devices.find((x) => x.id === deviceId);
			if (d && d.revokedAt === null) d.revokedAt = now;
		},
		async countActiveDevices() {
			return devices.filter((d) => d.revokedAt === null).length;
		},
		async deleteStalePairingCodes(before) {
			let n = 0;
			for (let i = codes.length - 1; i >= 0; i--) {
				const c = codes[i];
				if (c && ((c.usedAt && c.usedAt < before) || c.expiresAt < before)) {
					codes.splice(i, 1);
					n++;
				}
			}
			return n;
		},
	};
}
