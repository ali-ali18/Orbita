import { randomUUID } from "node:crypto";
import type { Clock } from "./memory-state.ts";
import {
	NOTIFICATION_INBOX_LIMIT,
	type NotificationInboxRecord,
	type NotificationInboxStore,
} from "./notification-inbox-store.ts";

/** Implementação em memória, para testes. Segue as mesmas regras da versão Prisma. */
export function createMemoryNotificationInboxStore(now: Clock): NotificationInboxStore {
	const rows = new Map<string, NotificationInboxRecord>();
	const newestFirst = () =>
		[...rows.values()].sort(
			(a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1),
		);
	return {
		async add(input) {
			if ([...rows.values()].some((r) => r.key === input.key)) return { created: false };
			const id = randomUUID();
			rows.set(id, { id, ...input, createdAt: now() });
			for (const old of newestFirst().slice(NOTIFICATION_INBOX_LIMIT)) rows.delete(old.id);
			return { created: true };
		},
		async list(limit = NOTIFICATION_INBOX_LIMIT) {
			return newestFirst()
				.slice(0, Math.max(0, limit))
				.map((r) => ({ ...r }));
		},
		async count() {
			return rows.size;
		},
		async remove(id) {
			return rows.delete(id);
		},
	};
}
