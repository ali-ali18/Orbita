import { badReference } from "./errors.ts";
import type { MemoryState } from "./memory-state.ts";
import { cleanPreferencesPatch } from "./preferences-rules.ts";
import { DEFAULT_PREFERENCES, type PreferencesRecord, type PreferencesStore } from "./preferences-store.ts";
import { archivedAccount } from "./references.ts";

export function createMemoryPreferencesStore(state: MemoryState): PreferencesStore {
	let current: PreferencesRecord = { ...DEFAULT_PREFERENCES, notificationApps: [] };
	const copy = (r: PreferencesRecord): PreferencesRecord => ({
		...r,
		notificationApps: [...r.notificationApps],
	});
	return {
		async get() {
			return copy(current);
		},
		async update(patch) {
			const clean = cleanPreferencesPatch(patch);
			for (const id of [clean.defaultAccountId, clean.leftoverAccountId]) {
				if (!id) continue;
				const account = state.accounts.get(id);
				if (!account) throw badReference();
				if (account.archivedAt !== null) throw archivedAccount();
			}
			current = { ...current, ...clean };
			return copy(current);
		},
	};
}
