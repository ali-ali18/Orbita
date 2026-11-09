import type { NotificationApp, NotificationInboxReason } from "@orbita/shared";
import type { Db } from "./client.ts";
import {
	NOTIFICATION_INBOX_LIMIT,
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
			const old = await db.notificationInbox.findMany({
				orderBy: [{ createdAt: "desc" }, { id: "desc" }],
				skip: NOTIFICATION_INBOX_LIMIT,
				select: { id: true },
			});
			if (old.length > 0) {
				await db.notificationInbox.deleteMany({ where: { id: { in: old.map((r) => r.id) } } });
			}
			return { created: true };
		},
		async list(limit = NOTIFICATION_INBOX_LIMIT) {
			const rows = await db.notificationInbox.findMany({
				orderBy: [{ createdAt: "desc" }, { id: "desc" }],
				take: Math.max(0, limit),
			});
			return rows.map(toRecord);
		},
		async count() {
			return db.notificationInbox.count();
		},
		async purgeOlderThan(before) {
			return (await db.notificationInbox.deleteMany({ where: { createdAt: { lt: before } } })).count;
		},
		async remove(id) {
			return (await db.notificationInbox.deleteMany({ where: { id } })).count === 1;
		},
	};
}
