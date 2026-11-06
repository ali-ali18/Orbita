import { randomUUID } from "node:crypto";
import type { AccountStore } from "./account-store.ts";
import { notFound } from "./errors.ts";
import { byCreated, type MemoryState } from "./memory-state.ts";
import { applyPatch, normalizeAccount } from "./rules.ts";

export function createMemoryAccountStore(state: MemoryState): AccountStore {
	const need = (id: string) => {
		const found = state.accounts.get(id);
		if (!found) throw notFound("Conta");
		return found;
	};
	return {
		async create(input) {
			const now = state.now();
			const record = {
				id: randomUUID(),
				...normalizeAccount(input),
				archivedAt: null,
				createdAt: now,
				updatedAt: now,
			};
			state.accounts.set(record.id, record);
			return { ...record };
		},
		async update(id, patch) {
			const current = need(id);
			const { name, kind, bankCode } = applyPatch(current, patch);
			const next = { ...current, ...normalizeAccount({ name, kind, bankCode }), updatedAt: state.now() };
			state.accounts.set(id, next);
			return { ...next };
		},
		async archive(id) {
			const current = need(id);
			if (current.archivedAt === null) {
				const now = state.now();
				state.accounts.set(id, { ...current, archivedAt: now, updatedAt: now });
			}
			return { ...need(id) };
		},
		async list() {
			return [...state.accounts.values()]
				.filter((a) => a.archivedAt === null)
				.sort(byCreated)
				.map((a) => ({ ...a }));
		},
		async get(id) {
			const found = state.accounts.get(id);
			return found ? { ...found } : null;
		},
	};
}
