import type { NotificationApp } from "@orbita/shared";
import type { Db } from "./client.ts";
import type { NotificationCancelRecord, NotificationCancelStore } from "./notification-cancel-store.ts";
import { isUniqueViolation } from "./prisma-errors.ts";

type Row = {
	key: string;
	app: string;
	last4: string;
	amountCents: number;
	merchant: string | null;
	postedAt: Date;
	consumedAt: Date | null;
	createdAt: Date;
};

const toRecord = (row: Row): NotificationCancelRecord => ({
	key: row.key,
	app: row.app as NotificationApp,
	last4: row.last4,
	amountCents: row.amountCents,
	merchant: row.merchant,
	postedAt: row.postedAt,
	consumedAt: row.consumedAt,
	createdAt: row.createdAt,
});

export function createPrismaNotificationCancelStore(db: Db, now: () => Date): NotificationCancelStore {
	return {
		async register({ consumed, ...input }) {
			const at = now();
			try {
				await db.notificationCancellation.create({
					data: { ...input, consumedAt: consumed ? at : null, createdAt: at },
				});
			} catch (e) {
				if (isUniqueViolation(e)) return { created: false };
				throw e;
			}
			return { created: true };
		},
		async hasAny(keys) {
			return (await db.notificationCancellation.count({ where: { key: { in: [...keys] } } })) > 0;
		},
		async listPending(app, since) {
			const rows = await db.notificationCancellation.findMany({
				where: { app, consumedAt: null, postedAt: { gte: since } },
				orderBy: [{ postedAt: "asc" }, { key: "asc" }],
			});
			return rows.map(toRecord);
		},
		async consume(key) {
			const done = await db.notificationCancellation.updateMany({
				where: { key, consumedAt: null },
				data: { consumedAt: now() },
			});
			return done.count === 1;
		},
		async purgeOlderThan(before) {
			return (await db.notificationCancellation.deleteMany({ where: { createdAt: { lt: before } } })).count;
		},
	};
}
