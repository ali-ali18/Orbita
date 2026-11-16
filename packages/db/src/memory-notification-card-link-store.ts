import { invalid, notFound } from "./errors.ts";
import type { MemoryState } from "./memory-state.ts";
import type {
	NotificationCardLinkRecord,
	NotificationCardLinkStore,
} from "./notification-card-link-store.ts";

/** Implementação em memória, para testes. Segue as mesmas regras da versão Prisma. */
export function createMemoryNotificationCardLinkStore(state: MemoryState): NotificationCardLinkStore {
	const rows = new Map<string, NotificationCardLinkRecord>();
	const keyOf = (app: string, last4: string) => `${app}:${last4}`;
	return {
		async get(app, last4) {
			const found = rows.get(keyOf(app, last4));
			return found ? { ...found } : null;
		},
		async set(app, last4, cardId, origin = "choice") {
			if (!/^\d{4}$/.test(last4)) throw invalid("O final do cartão tem 4 dígitos.");
			if (!state.cards.has(cardId)) throw notFound("Cartão", "o");
			const key = keyOf(app, last4);
			const record = { app, last4, cardId, origin, createdAt: rows.get(key)?.createdAt ?? state.now() };
			rows.set(key, record);
			return { ...record };
		},
		async list() {
			return [...rows.values()]
				.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
				.map((r) => ({ ...r }));
		},
		async remove(app, last4) {
			return rows.delete(keyOf(app, last4));
		},
	};
}
