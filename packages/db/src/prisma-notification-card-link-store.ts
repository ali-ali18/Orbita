import type { NotificationApp } from "@orbita/shared";
import type { Db } from "./client.ts";
import { invalid, notFound } from "./errors.ts";
import type {
	NotificationCardLinkRecord,
	NotificationCardLinkStore,
} from "./notification-card-link-store.ts";
import { isForeignKeyViolation } from "./prisma-errors.ts";

type Row = { app: string; last4: string; cardId: string; createdAt: Date };

const toRecord = (row: Row): NotificationCardLinkRecord => ({
	app: row.app as NotificationApp,
	last4: row.last4,
	cardId: row.cardId,
	createdAt: row.createdAt,
});

export function createPrismaNotificationCardLinkStore(db: Db, now: () => Date): NotificationCardLinkStore {
	return {
		async get(app, last4) {
			const row = await db.notificationCardLink.findUnique({ where: { app_last4: { app, last4 } } });
			return row ? toRecord(row) : null;
		},
		async set(app, last4, cardId) {
			if (!/^\d{4}$/.test(last4)) throw invalid("O final do cartão tem 4 dígitos.");
			try {
				const row = await db.notificationCardLink.upsert({
					where: { app_last4: { app, last4 } },
					create: { app, last4, cardId, createdAt: now() },
					update: { cardId },
				});
				return toRecord(row);
			} catch (e) {
				if (isForeignKeyViolation(e)) throw notFound("Cartão", "o");
				throw e;
			}
		},
	};
}
