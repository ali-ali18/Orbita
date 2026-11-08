import type { IdempotencyRecord, IdempotencyStore } from "./idempotency-store.ts";

/** Implementação em memória, para testes. Segue as mesmas regras da versão Prisma. */
export function createMemoryIdempotencyStore(): IdempotencyStore {
	const rows = new Map<string, IdempotencyRecord>();
	const id = (deviceId: string, key: string) => `${deviceId}\u0000${key}`;
	return {
		async begin({ key, deviceId, requestHash, now, expiresAt, staleBefore }) {
			const current = rows.get(id(deviceId, key));
			const reusable =
				current && (current.expiresAt <= now || (current.status === null && current.createdAt < staleBefore));
			if (current && !reusable) return { outcome: "existing", record: { ...current } };
			rows.set(id(deviceId, key), {
				key,
				deviceId,
				requestHash,
				status: null,
				body: null,
				createdAt: now,
				expiresAt,
			});
			return { outcome: "started" };
		},
		async complete({ key, deviceId, status, body }) {
			const row = rows.get(id(deviceId, key));
			if (row) {
				row.status = status;
				row.body = body;
			}
		},
		async release({ key, deviceId }) {
			if (rows.get(id(deviceId, key))?.status === null) rows.delete(id(deviceId, key));
		},
		async deleteExpired(before) {
			let n = 0;
			for (const [k, r] of rows) {
				if (r.expiresAt < before) {
					rows.delete(k);
					n++;
				}
			}
			return n;
		},
	};
}
