import type { MemoryState } from "./memory-state.ts";
import type { SecretStore } from "./secret-store.ts";

export function createMemorySecretStore(state: MemoryState): SecretStore {
	const stored = new Map<string, string>();
	return {
		async put(name, ciphertext, updatedBy) {
			const now = state.now();
			const current = state.secrets.get(name);
			state.secrets.set(name, { name, updatedAt: now, updatedBy, createdAt: current?.createdAt ?? now });
			stored.set(name, ciphertext);
			return { name, updatedAt: now, updatedBy };
		},
		async get(name) {
			return stored.get(name) ?? null;
		},
		async list() {
			return [...state.secrets.values()]
				.sort((a, b) => a.name.localeCompare(b.name))
				.map(({ name, updatedAt, updatedBy }) => ({ name, updatedAt, updatedBy }));
		},
		async remove(name) {
			stored.delete(name);
			return state.secrets.delete(name);
		},
	};
}
