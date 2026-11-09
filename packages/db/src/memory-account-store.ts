import { randomUUID } from "node:crypto";
import type { AccountStore } from "./account-store.ts";
import { DataError, notFound } from "./errors.ts";
import { byCreated, type MemoryState } from "./memory-state.ts";
import { EXTERNAL_TAKEN_MESSAGE } from "./messages.ts";
import { applyPatch, normalizeAccount, normalizeIdentity } from "./rules.ts";

export function createMemoryAccountStore(state: MemoryState): AccountStore {
	const need = (id: string) => {
		const found = state.accounts.get(id);
		if (!found) throw notFound("Conta");
		return found;
	};
	return {
		async create(input) {
			const now = state.now();
			const identity = normalizeIdentity(input);
			if (
				identity.externalId !== null &&
				[...state.accounts.values()].some(
					(x) => x.source === identity.source && x.externalId === identity.externalId,
				)
			) {
				throw new DataError("duplicate", EXTERNAL_TAKEN_MESSAGE);
			}
			const record = {
				id: randomUUID(),
				...normalizeAccount(input),
				...identity,
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
		async findByExternal(source, externalId) {
			const found = [...state.accounts.values()].find(
				(a) => a.source === source && a.externalId === externalId,
			);
			return found ? { ...found } : null;
		},
		async relinkExternal(id, externalId) {
			const current = state.accounts.get(id);
			const next = externalId.trim();
			if (!current || current.source === "manual" || next === "") return null;
			if ([...state.accounts.values()].some((x) => x.source === current.source && x.externalId === next)) {
				return null;
			}
			const updated = { ...current, externalId: next, updatedAt: state.now() };
			state.accounts.set(id, updated);
			return { ...updated };
		},
	};
}
