import type { Clock } from "./memory-state.ts";
import type { NotificationCancelRecord, NotificationCancelStore } from "./notification-cancel-store.ts";

/** Implementação em memória, para testes. Segue as mesmas regras da versão Prisma. */
export function createMemoryNotificationCancelStore(now: Clock): NotificationCancelStore {
	const rows = new Map<string, NotificationCancelRecord>();
	return {
		async register({ consumed, ...input }) {
			if (rows.has(input.key)) return { created: false };
			const at = now();
			rows.set(input.key, { ...input, consumedAt: consumed ? at : null, createdAt: at });
			return { created: true };
		},
		async hasAny(keys) {
			return keys.some((k) => rows.has(k));
		},
		async listPending(app, since) {
			return [...rows.values()]
				.filter((r) => r.app === app && r.consumedAt === null && r.postedAt >= since)
				.sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime())
				.map((r) => ({ ...r }));
		},
		async consume(key) {
			const found = rows.get(key);
			if (!found || found.consumedAt !== null) return false;
			rows.set(key, { ...found, consumedAt: now() });
			return true;
		},
		async purgeOlderThan(before) {
			let n = 0;
			for (const r of [...rows.values()]) {
				if (r.createdAt < before) {
					rows.delete(r.key);
					n++;
				}
			}
			return n;
		},
	};
}
