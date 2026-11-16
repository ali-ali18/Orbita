import { randomUUID } from "node:crypto";
import type { Clock } from "./memory-state.ts";
import {
	NOTIFICATION_INBOX_LIMIT,
	NOTIFICATION_PROMO_LIMIT,
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
			rows.set(id, { id, ...input, ownerKept: false, createdAt: now() });
			for (const old of newestFirst()
				.filter((r) => r.reason !== "promo")
				.slice(NOTIFICATION_INBOX_LIMIT))
				rows.delete(old.id);
			for (const old of newestFirst()
				.filter((r) => r.reason === "promo")
				.slice(NOTIFICATION_PROMO_LIMIT))
				rows.delete(old.id);
			return { created: true };
		},
		async list(limit = NOTIFICATION_INBOX_LIMIT + NOTIFICATION_PROMO_LIMIT) {
			return newestFirst()
				.slice(0, Math.max(0, limit))
				.map((r) => ({ ...r }));
		},
		async count() {
			return [...rows.values()].filter((r) => r.reason !== "promo").length;
		},
		async countHidden() {
			return [...rows.values()].filter((r) => r.reason === "promo").length;
		},
		async setReason(key, reason) {
			const found = [...rows.values()].find((r) => r.key === key);
			// O que o dono marcou "É compra" não volta a ser oculto.
			if (found && !(found.ownerKept && reason === "promo")) rows.set(found.id, { ...found, reason });
		},
		async keepAsPurchase(id) {
			const found = rows.get(id);
			if (found?.reason !== "promo") return false;
			rows.set(id, { ...found, reason: "format", ownerKept: true });
			return true;
		},
		async purgeOlderThan(before) {
			let n = 0;
			for (const r of [...rows.values()]) {
				if (r.createdAt < before) {
					rows.delete(r.id);
					n++;
				}
			}
			return n;
		},
		async remove(id) {
			return rows.delete(id);
		},
	};
}
