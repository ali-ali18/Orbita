import type { Db } from "./client.ts";
import type { IdempotencyBegin, IdempotencyStore } from "./idempotency-store.ts";
import { isUniqueViolation } from "./prisma-errors.ts";

export function createPrismaIdempotencyStore(db: Db): IdempotencyStore {
	const store: IdempotencyStore = {
		async begin(input): Promise<IdempotencyBegin> {
			const { key, deviceId, requestHash, now, expiresAt, staleBefore } = input;
			const fresh = { requestHash, status: null, body: null, createdAt: now, expiresAt };
			try {
				await db.idempotencyKey.create({ data: { key, deviceId, ...fresh } });
				return { outcome: "started" };
			} catch (e) {
				if (!isUniqueViolation(e)) throw e;
			}
			// Já existe. Retomar uma reserva velha é um UPDATE só, com as condições no WHERE: se dois pedidos
			// tentarem, o Postgres deixa passar um (o outro reavalia o WHERE e não casa mais).
			const taken = await db.idempotencyKey.updateMany({
				where: {
					deviceId,
					key,
					OR: [{ expiresAt: { lte: now } }, { status: null, createdAt: { lt: staleBefore } }],
				},
				data: fresh,
			});
			if (taken.count === 1) return { outcome: "started" };
			const row = await db.idempotencyKey.findUnique({ where: { deviceId_key: { deviceId, key } } });
			// Sumiu entre as duas leituras (limpeza ou `release`): começa de novo.
			if (!row) return store.begin(input);
			return {
				outcome: "existing",
				record: {
					key: row.key,
					deviceId: row.deviceId,
					requestHash: row.requestHash,
					status: row.status,
					body: row.body,
					createdAt: row.createdAt,
					expiresAt: row.expiresAt,
				},
			};
		},

		async complete({ key, deviceId, status, body }) {
			await db.idempotencyKey.updateMany({ where: { deviceId, key }, data: { status, body } });
		},

		async release({ key, deviceId }) {
			await db.idempotencyKey.deleteMany({ where: { deviceId, key, status: null } });
		},

		async deleteExpired(before) {
			const res = await db.idempotencyKey.deleteMany({ where: { expiresAt: { lt: before } } });
			return res.count;
		},
	};
	return store;
}
