import type { NotificationApp } from "@orbita/shared";
import type { Db } from "./client.ts";
import { badReference } from "./errors.ts";
import { cleanPreferencesPatch } from "./preferences-rules.ts";
import { DEFAULT_PREFERENCES, type PreferencesRecord, type PreferencesStore } from "./preferences-store.ts";
import { archivedAccount, archivedGoal, missingGoal } from "./references.ts";

const ID = "main";

type Row = {
	displayName: string | null;
	defaultAccountId: string | null;
	notificationCapture: boolean;
	notificationApps: string[];
	notificationToReview: boolean;
	budgetAlertPercent: number;
	leftoverAccountId: string | null;
	leftoverGoalId: string | null;
};

const toRecord = (row: Row): PreferencesRecord => ({
	displayName: row.displayName,
	defaultAccountId: row.defaultAccountId,
	notificationCapture: row.notificationCapture,
	notificationApps: row.notificationApps as NotificationApp[],
	notificationToReview: row.notificationToReview,
	budgetAlertPercent: row.budgetAlertPercent,
	leftoverAccountId: row.leftoverAccountId,
	leftoverGoalId: row.leftoverGoalId,
});

export function createPrismaPreferencesStore(db: Db): PreferencesStore {
	return {
		async get() {
			const row = await db.appPreferences.findUnique({ where: { id: ID } });
			return row ? toRecord(row) : { ...DEFAULT_PREFERENCES, notificationApps: [] };
		},
		async update(patch) {
			const clean = cleanPreferencesPatch(patch);
			if (clean.leftoverGoalId) {
				const goal = await db.goal.findUnique({
					where: { id: clean.leftoverGoalId },
					select: { archivedAt: true },
				});
				if (!goal) throw missingGoal();
				if (goal.archivedAt !== null) throw archivedGoal();
			}
			for (const id of [clean.defaultAccountId, clean.leftoverAccountId]) {
				if (!id) continue;
				const account = await db.account.findUnique({ where: { id }, select: { archivedAt: true } });
				if (!account) throw badReference();
				if (account.archivedAt !== null) throw archivedAccount();
			}
			const row = await db.appPreferences.upsert({
				where: { id: ID },
				update: clean,
				create: { id: ID, ...clean },
			});
			return toRecord(row);
		},
	};
}
