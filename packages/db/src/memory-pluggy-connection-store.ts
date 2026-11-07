import { DataError } from "./errors.ts";
import { byCreated, type MemoryState } from "./memory-state.ts";
import { PLUGGY_CONNECTION_TAKEN_MESSAGE } from "./messages.ts";
import { normalizeConnection, normalizeSyncResult } from "./pluggy-connection-rules.ts";
import type { PluggyConnectionStore } from "./pluggy-connection-store.ts";

export function createMemoryPluggyConnectionStore(state: MemoryState): PluggyConnectionStore {
	return {
		async add(input) {
			const data = normalizeConnection(input);
			if (state.pluggyConnections.has(data.id))
				throw new DataError("duplicate", PLUGGY_CONNECTION_TAKEN_MESSAGE);
			const record = { ...data, createdAt: state.now(), lastSyncAt: null, lastStatus: null, lastError: null };
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
			const { status, error, syncedAt } = normalizeSyncResult(result);
			const next = {
				...current,
				lastStatus: status,
				lastError: error,
				lastSyncAt: syncedAt ?? current.lastSyncAt,
			};
			state.pluggyConnections.set(id, next);
			return { ...next };
		},
	};
}
