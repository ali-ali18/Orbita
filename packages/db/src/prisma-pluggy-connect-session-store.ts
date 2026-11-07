import type { Db } from "./client.ts";
import type { PluggyConnectSessionStore } from "./pluggy-connect-session-store.ts";

export function createPrismaPluggyConnectSessionStore(db: Db): PluggyConnectSessionStore {
	return {
		async create({ tokenHash, expiresAt, now }) {
			await db.$transaction(async (tx) => {
				await tx.pluggyConnectSession.updateMany({
					where: { usedAt: null, expiresAt: { gt: now } },
					data: { expiresAt: now },
				});
				await tx.pluggyConnectSession.create({ data: { tokenHash, expiresAt } });
			});
		},

		async isActive(tokenHash, now) {
			const count = await db.pluggyConnectSession.count({
				where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
			});
			return count === 1;
		},

		async consume(tokenHash, now) {
			// Um UPDATE só, com as condições no WHERE: o Postgres serializa as corridas na linha.
			const res = await db.pluggyConnectSession.updateMany({
				where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
				data: { usedAt: now },
			});
			return res.count === 1;
		},

		async deleteStale(before) {
			const res = await db.pluggyConnectSession.deleteMany({
				where: { OR: [{ usedAt: { lt: before } }, { expiresAt: { lt: before } }] },
			});
			return res.count;
		},
	};
}
