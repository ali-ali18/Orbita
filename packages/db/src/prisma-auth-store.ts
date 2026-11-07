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

		findActivePairingCode(now, maxAttempts) {
			return db.pairingCode.findFirst({
				where: { usedAt: null, expiresAt: { gt: now }, attempts: { lt: maxAttempts } },
				orderBy: { createdAt: "desc" },
			});
		},

		async reserveAttempt({ codeId, maxAttempts, now }) {
			// Um UPDATE só, com as condições no WHERE: o Postgres serializa as corridas na linha.
			const res = await db.pairingCode.updateMany({
				where: { id: codeId, usedAt: null, expiresAt: { gt: now }, attempts: { lt: maxAttempts } },
				data: { attempts: { increment: 1 } },
			});
			return res.count === 1;
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

		findDeviceById(id) {
			return db.device.findUnique({ where: { id } });
		},

		async touchDevice({ deviceId, now }) {
			await db.device.update({ where: { id: deviceId }, data: { lastSeenAt: now } });
		},

		async revokeDevice({ deviceId, now }) {
			await db.device.updateMany({ where: { id: deviceId, revokedAt: null }, data: { revokedAt: now } });
		},

		countActiveDevices() {
			return db.device.count({ where: { revokedAt: null } });
		},

		async deleteStalePairingCodes(before) {
			const res = await db.pairingCode.deleteMany({
				where: { OR: [{ usedAt: { lt: before } }, { expiresAt: { lt: before } }] },
			});
			return res.count;
		},
	};
}
