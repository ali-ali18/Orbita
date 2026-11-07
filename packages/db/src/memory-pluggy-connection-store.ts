import { DataError } from "./errors.ts";
import { byCreated, type MemoryState } from "./memory-state.ts";
import { PLUGGY_CONNECTION_TAKEN_MESSAGE } from "./messages.ts";
import { normalizeConnection, normalizeLabel, normalizeSyncResult } from "./pluggy-connection-rules.ts";
import type { PluggyConnectionStore } from "./pluggy-connection-store.ts";

export function createMemoryPluggyConnectionStore(state: MemoryState): PluggyConnectionStore {
	return {
		async add(input) {
			const data = normalizeConnection(input);
			if (state.pluggyConnections.has(data.id))
				throw new DataError("duplicate", PLUGGY_CONNECTION_TAKEN_MESSAGE);
			const record = {
				...data,
				createdAt: state.now(),
				lastSyncAt: null,
				lastStatus: null,
				lastError: null,
				accountCount: 0,
				cardCount: 0,
			};
			state.pluggyConnections.set(data.id, record);
			return { ...record };
		},
		async remove(id) {
			return state.pluggyConnections.delete(id.trim().toLowerCase());
		},
		async get(id) {
			const found = state.pluggyConnections.get(id.trim().toLowerCase());
			return found ? { ...found } : null;
		},
		async list() {
			return [...state.pluggyConnections.values()].sort(byCreated).map((c) => ({ ...c }));
		},
		async recordSync(id, result) {
			const current = state.pluggyConnections.get(id);
			if (!current) return null;
			const { status, error, syncedAt, counts } = normalizeSyncResult(result);
			const next = {
				...current,
				lastStatus: status,
				lastError: error,
				lastSyncAt: syncedAt ?? current.lastSyncAt,
				...(counts ?? {}),
			};
			state.pluggyConnections.set(id, next);
			return { ...next };
		},
		async rename(id, label) {
			const key = id.trim().toLowerCase();
			const current = state.pluggyConnections.get(key);
			const clean = normalizeLabel(label);
			if (!current) return null;
			const next = { ...current, label: clean, labelEditedByOwner: true };
			state.pluggyConnections.set(key, next);
			return { ...next };
		},
		async resetSyncWindow() {
			for (const [id, current] of state.pluggyConnections) {
				state.pluggyConnections.set(id, { ...current, lastSyncAt: null });
			}
			return state.pluggyConnections.size;
		},
		async setAutoLabel(id, label) {
			const current = state.pluggyConnections.get(id);
			const clean = normalizeLabel(label);
			if (!current || current.labelEditedByOwner) return false;
			state.pluggyConnections.set(id, { ...current, label: clean });
			return true;
		},
	};
}
