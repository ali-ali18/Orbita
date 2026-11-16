import type { NotificationApp } from "@orbita/shared";
import type { Db } from "./client.ts";
import { invalid, notFound } from "./errors.ts";
import type {
	NotificationCardLinkRecord,
	NotificationCardLinkStore,
	NotificationLinkOrigin,
} from "./notification-card-link-store.ts";
import { isForeignKeyViolation } from "./prisma-errors.ts";

type Row = { app: string; last4: string; cardId: string; origin: string; createdAt: Date };

const toRecord = (row: Row): NotificationCardLinkRecord => ({
	app: row.app as NotificationApp,
	last4: row.last4,
	cardId: row.cardId,
	origin: row.origin as NotificationLinkOrigin,
	createdAt: row.createdAt,
});

export function createPrismaNotificationCardLinkStore(db: Db, now: () => Date): NotificationCardLinkStore {
	return {
		async get(app, last4) {
			const row = await db.notificationCardLink.findUnique({ where: { app_last4: { app, last4 } } });
			return row ? toRecord(row) : null;
		},
		async set(app, last4, cardId, origin = "choice") {
			if (!/^\d{4}$/.test(last4)) throw invalid("O final do cartão tem 4 dígitos.");
			try {
				const row = await db.notificationCardLink.upsert({
					where: { app_last4: { app, last4 } },
					create: { app, last4, cardId, origin, createdAt: now() },
					// Palpite só cria: nunca sobrescreve uma ligação que já existe.
					update: origin === "guess" ? {} : { cardId, origin },
				});
				return toRecord(row);
			} catch (e) {
				if (isForeignKeyViolation(e)) throw notFound("Cartão", "o");
				throw e;
			}
		},
		async list() {
			const rows = await db.notificationCardLink.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
			return rows.map(toRecord);
		},
		async remove(app, last4) {
			return (await db.notificationCardLink.deleteMany({ where: { app, last4 } })).count === 1;
		},
	};
}
