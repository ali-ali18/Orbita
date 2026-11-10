import { randomUUID } from "node:crypto";
import type { AccountStore } from "./account-store.ts";
import { DataError, notFound } from "./errors.ts";
import { byCreated, type MemoryState } from "./memory-state.ts";
import { EXTERNAL_TAKEN_MESSAGE } from "./messages.ts";
import { applyPatch, cleanBalance, normalizeAccount, normalizeIdentity } from "./rules.ts";

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
				balanceCents: null,
				balanceSyncedAt: null,
				archivedAt: null,
				connectionId: null,
				archiveReason: null,
				unlinkedMisses: 0,
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
		async linkConnection(id, connectionId) {
			const current = state.accounts.get(id);
			if (!current || current.source === "manual") return null;
			const next = { ...current, connectionId };
			state.accounts.set(id, next);
			return { ...next };
		},
		async archiveByConnection(connectionId) {
			const at = state.now();
			let count = 0;
			for (const [id, x] of state.accounts) {
				if (x.connectionId !== connectionId || x.archivedAt !== null) continue;
				state.accounts.set(id, { ...x, archivedAt: at, archiveReason: "connection_removed", updatedAt: at });
				count += 1;
			}
			return count;
		},
		async archiveOrphans(liveConnectionIds, { unlinked }) {
			const at = state.now();
			const live = new Set(liveConnectionIds);
			let count = 0;
			for (const [id, x] of state.accounts) {
				if (x.source !== "pluggy" || x.archivedAt !== null) continue;
				let gone: boolean;
				let misses = x.unlinkedMisses;
				if (x.connectionId !== null) gone = !live.has(x.connectionId);
				else if (unlinked === "all") gone = true;
				else if (unlinked === "strike") {
					misses += 1;
					gone = misses >= 2;
				} else gone = false;
				state.accounts.set(
					id,
					gone
						? {
								...x,
								unlinkedMisses: misses,
								archivedAt: at,
								archiveReason: "connection_removed",
								updatedAt: at,
							}
						: { ...x, unlinkedMisses: misses },
				);
				if (gone) count += 1;
			}
			return count;
		},
		async archiveExternalAsRemoved(externalId) {
			const at = state.now();
			for (const [id, x] of state.accounts) {
				if (x.source !== "pluggy" || x.externalId !== externalId || x.archivedAt !== null) continue;
				state.accounts.set(id, { ...x, archivedAt: at, archiveReason: "connection_removed", updatedAt: at });
				return true;
			}
			return false;
		},
		async listRemovedByConnection() {
			return [...state.accounts.values()]
				.filter((x) => x.archivedAt !== null && x.archiveReason === "connection_removed")
				.sort(byCreated)
				.map((x) => ({ ...x }));
		},
		async restoreFromConnection(id) {
			const current = state.accounts.get(id);
			if (!current) return null;
			if (current.archivedAt === null || current.archiveReason !== "connection_removed")
				return { ...current };
			const next = { ...current, archivedAt: null, archiveReason: null, updatedAt: state.now() };
			state.accounts.set(id, next);
			return { ...next };
		},
		async recordBalance(id, balanceCents, syncedAt) {
			const next = { ...need(id), balanceCents: cleanBalance(balanceCents), balanceSyncedAt: syncedAt };
			state.accounts.set(id, next);
			return { ...next };
		},
	};
}
