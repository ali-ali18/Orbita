import type { Db } from "./client.ts";
import type { PluggyConnectSessionStore } from "./pluggy-connect-session-store.ts";

export function createPrismaPluggyConnectSessionStore(db: Db): PluggyConnectSessionStore {
	return {
		async create({ tokenHash, deviceId, expiresAt, now, updateItemId }) {
			await db.$transaction(async (tx) => {
				// Serializa os criadores: sem isto, dois pedidos simultâneos expirariam só as sessões que já existiam
				// e as duas novas ficariam ativas. O lock vale até o fim da transação.
				await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('orbita:pluggy_connect_sessions'))`;
				await tx.pluggyConnectSession.updateMany({
					where: { usedAt: null, expiresAt: { gt: now } },
					data: { expiresAt: now },
				});
				await tx.pluggyConnectSession.create({
					data: { tokenHash, deviceId, expiresAt, createdAt: now, updateItemId: updateItemId ?? null },
				});
			});
		},

		async find(tokenHash, now) {
			const row = await db.pluggyConnectSession.findFirst({
				where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
				select: { deviceId: true, createdAt: true, updateItemId: true },
			});
			return row ?? null;
		},

		async consume(tokenHash, now) {
			// Um UPDATE só, com as condições no WHERE: o Postgres serializa as corridas na linha.
			const res = await db.pluggyConnectSession.updateMany({
				where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
				data: { usedAt: now },
			});
			return res.count === 1;
		},

		async release(tokenHash) {
			await db.pluggyConnectSession.updateMany({ where: { tokenHash }, data: { usedAt: null } });
		},

		async deleteStale(before) {
			const res = await db.pluggyConnectSession.deleteMany({
				where: { OR: [{ usedAt: { lt: before } }, { expiresAt: { lt: before } }] },
			});
			return res.count;
		},
	};
}
