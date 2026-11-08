import { badReference } from "./errors.ts";
import type { MemoryState } from "./memory-state.ts";
import { cleanPreferencesPatch } from "./preferences-rules.ts";
import type { PreferencesRecord, PreferencesStore } from "./preferences-store.ts";
import { archivedAccount, archivedGoal, missingGoal } from "./references.ts";

export function createMemoryPreferencesStore(state: MemoryState): PreferencesStore {
	const copy = (r: PreferencesRecord): PreferencesRecord => ({
		...r,
		notificationApps: [...r.notificationApps],
	});
	return {
		async get() {
			return copy(state.preferences);
		},
		async update(patch) {
			const clean = cleanPreferencesPatch(patch);
			if (clean.leftoverGoalId) {
				const goal = state.goals.get(clean.leftoverGoalId);
				if (!goal) throw missingGoal();
				if (goal.archivedAt !== null) throw archivedGoal();
			}
			for (const id of [clean.defaultAccountId, clean.leftoverAccountId]) {
				if (!id) continue;
				const account = state.accounts.get(id);
				if (!account) throw badReference();
				if (account.archivedAt !== null) throw archivedAccount();
			}
			state.preferences = { ...state.preferences, ...clean };
			return copy(state.preferences);
		},
	};
}
