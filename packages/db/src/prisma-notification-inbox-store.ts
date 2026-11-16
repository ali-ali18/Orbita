import type { NotificationApp, NotificationInboxReason } from "@orbita/shared";
import type { Db } from "./client.ts";
import {
	NOTIFICATION_INBOX_LIMIT,
	NOTIFICATION_PROMO_LIMIT,
	type NotificationInboxRecord,
	type NotificationInboxStore,
} from "./notification-inbox-store.ts";
import { isUniqueViolation } from "./prisma-errors.ts";

type Row = {
	id: string;
	key: string;
	app: string;
	title: string;
	text: string;
	reason: string;
	ownerKept: boolean;
	postedAt: Date;
	createdAt: Date;
};

const toRecord = (row: Row): NotificationInboxRecord => ({
	id: row.id,
	key: row.key,
	app: row.app as NotificationApp,
	title: row.title,
	text: row.text,
	reason: row.reason as NotificationInboxReason,
	ownerKept: row.ownerKept,
	postedAt: row.postedAt,
	createdAt: row.createdAt,
});

export function createPrismaNotificationInboxStore(db: Db, now: () => Date): NotificationInboxStore {
	return {
		async add(input) {
			try {
				await db.notificationInbox.create({ data: { ...input, createdAt: now() } });
			} catch (e) {
				if (isUniqueViolation(e)) return { created: false };
				throw e;
			}
			for (const [promo, limit] of [
				[false, NOTIFICATION_INBOX_LIMIT],
				[true, NOTIFICATION_PROMO_LIMIT],
			] as const) {
				const old = await db.notificationInbox.findMany({
					where: promo ? { reason: "promo" } : { reason: { not: "promo" } },
					orderBy: [{ createdAt: "desc" }, { id: "desc" }],
					skip: limit,
					select: { id: true },
				});
				if (old.length > 0) {
					await db.notificationInbox.deleteMany({ where: { id: { in: old.map((r) => r.id) } } });
				}
			}
			return { created: true };
		},
		async list(limit = NOTIFICATION_INBOX_LIMIT + NOTIFICATION_PROMO_LIMIT) {
			const rows = await db.notificationInbox.findMany({
				orderBy: [{ createdAt: "desc" }, { id: "desc" }],
				take: Math.max(0, limit),
			});
			return rows.map(toRecord);
		},
		async count() {
			return db.notificationInbox.count({ where: { reason: { not: "promo" } } });
		},
		async countHidden() {
			return db.notificationInbox.count({ where: { reason: "promo" } });
		},
		async setReason(key, reason) {
			await db.notificationInbox.updateMany({
				where: reason === "promo" ? { key, ownerKept: false } : { key },
				data: { reason },
			});
		},
		async keepAsPurchase(id) {
			const done = await db.notificationInbox.updateMany({
				where: { id, reason: "promo" },
				data: { reason: "format", ownerKept: true },
			});
			return done.count === 1;
		},
		async purgeOlderThan(before) {
			return (await db.notificationInbox.deleteMany({ where: { createdAt: { lt: before } } })).count;
		},
		async remove(id) {
			return (await db.notificationInbox.deleteMany({ where: { id } })).count === 1;
		},
	};
}
