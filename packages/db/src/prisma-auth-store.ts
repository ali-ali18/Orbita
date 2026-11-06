import type { AuthStore } from "./auth-store.ts";
import type { Db } from "./client.ts";

export function createPrismaAuthStore(db: Db): AuthStore {
	return {
		async replaceActivePairingCode({ codeHash, expiresAt, now }) {
			return db.$transaction(async (tx) => {
				await tx.pairingCode.updateMany({
					where: { usedAt: null, expiresAt: { gt: now } },
					data: { expiresAt: now },
				});
				return tx.pairingCode.create({ data: { codeHash, expiresAt } });
			});
		},

		findActivePairingCode(now) {
			return db.pairingCode.findFirst({
				where: { usedAt: null, expiresAt: { gt: now } },
				orderBy: { createdAt: "desc" },
			});
		},

		async registerFailedAttempt({ codeId, maxAttempts, now }) {
			const code = await db.pairingCode.update({
				where: { id: codeId },
				data: { attempts: { increment: 1 } },
			});
			if (code.attempts >= maxAttempts) {
				await db.pairingCode.update({ where: { id: codeId }, data: { expiresAt: now } });
			}
		},

		async consumePairingCode({ codeId, now, deviceName, tokenHash }) {
			return db.$transaction(async (tx) => {
				const used = await tx.pairingCode.updateMany({
					where: { id: codeId, usedAt: null, expiresAt: { gt: now } },
					data: { usedAt: now },
				});
				if (used.count !== 1) return null;
				return tx.device.create({ data: { name: deviceName, tokenHash, lastSeenAt: now } });
			});
		},

		findDeviceByTokenHash(tokenHash) {
			return db.device.findUnique({ where: { tokenHash } });
		},

		async touchDevice({ deviceId, now }) {
			await db.device.update({ where: { id: deviceId }, data: { lastSeenAt: now } });
		},

		async revokeDevice({ deviceId, now }) {
			await db.device.updateMany({ where: { id: deviceId, revokedAt: null }, data: { revokedAt: now } });
		},

		async deleteStalePairingCodes(before) {
			const res = await db.pairingCode.deleteMany({
				where: { OR: [{ usedAt: { lt: before } }, { expiresAt: { lt: before } }] },
			});
			return res.count;
		},
	};
}
