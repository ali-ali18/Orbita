import { randomUUID } from "node:crypto";
import { type CardStore, toCardConfig } from "./card-store.ts";
import { DataError, notFound } from "./errors.ts";
import { byCreated, type MemoryState } from "./memory-state.ts";
import { EXTERNAL_TAKEN_MESSAGE } from "./messages.ts";
import { applyCardPatch, cleanAvailable, normalizeCard, normalizeIdentity } from "./rules.ts";

export function createMemoryCardStore(state: MemoryState): CardStore {
	const need = (id: string) => {
		const found = state.cards.get(id);
		if (!found) throw notFound("Cartão", "o");
		return found;
	};
	return {
		async create(input) {
			const now = state.now();
			const identity = normalizeIdentity(input);
			if (
				identity.externalId !== null &&
				[...state.cards.values()].some(
					(x) => x.source === identity.source && x.externalId === identity.externalId,
				)
			) {
				throw new DataError("duplicate", EXTERNAL_TAKEN_MESSAGE);
			}
			const record = {
				id: randomUUID(),
				...normalizeCard(input),
				...identity,
				availableCents: null,
				balanceCents: null,
				limitSyncedAt: null,
				archivedAt: null,
				connectionId: null,
				archiveReason: null,
				createdAt: now,
				updatedAt: now,
			};
			state.cards.set(record.id, record);
			return { ...record };
		},
		async update(id, patch) {
			const current = need(id);
			const next = { ...current, ...normalizeCard(applyCardPatch(current, patch)), updatedAt: state.now() };
			state.cards.set(id, next);
			return { ...next };
		},
		async archive(id) {
			const current = need(id);
			if (current.archivedAt === null) {
				const now = state.now();
				state.cards.set(id, { ...current, archivedAt: now, updatedAt: now });
			}
			return { ...need(id) };
		},
		async list() {
			return [...state.cards.values()]
				.filter((c) => c.archivedAt === null)
				.sort(byCreated)
				.map((c) => ({ ...c }));
		},
		async get(id) {
			const found = state.cards.get(id);
			return found ? { ...found } : null;
		},
		async findByExternal(source, externalId) {
			const found = [...state.cards.values()].find((c) => c.source === source && c.externalId === externalId);
			return found ? { ...found } : null;
		},
		async relinkExternal(id, externalId) {
			const current = state.cards.get(id);
			const next = externalId.trim();
			if (!current || current.source === "manual" || next === "") return null;
			if ([...state.cards.values()].some((x) => x.source === current.source && x.externalId === next)) {
				return null;
			}
			const updated = { ...current, externalId: next, updatedAt: state.now() };
			state.cards.set(id, updated);
			return { ...updated };
		},
		async linkConnection(id, connectionId) {
			const current = state.cards.get(id);
			if (!current || current.source === "manual") return null;
			const next = { ...current, connectionId };
			state.cards.set(id, next);
			return { ...next };
		},
		async archiveByConnection(connectionId) {
			const at = state.now();
			let count = 0;
			for (const [id, x] of state.cards) {
				if (x.connectionId !== connectionId || x.archivedAt !== null) continue;
				state.cards.set(id, { ...x, archivedAt: at, archiveReason: "connection_removed", updatedAt: at });
				count += 1;
			}
			return count;
		},
		async archiveOrphans(liveConnectionIds, { includeUnlinked }) {
			const at = state.now();
			const live = new Set(liveConnectionIds);
			let count = 0;
			for (const [id, x] of state.cards) {
				if (x.source !== "pluggy" || x.archivedAt !== null) continue;
				const gone = x.connectionId === null ? includeUnlinked : !live.has(x.connectionId);
				if (!gone) continue;
				state.cards.set(id, { ...x, archivedAt: at, archiveReason: "connection_removed", updatedAt: at });
				count += 1;
			}
			return count;
		},
		async restoreFromConnection(id) {
			const current = state.cards.get(id);
			if (!current) return null;
			if (current.archivedAt === null || current.archiveReason !== "connection_removed")
				return { ...current };
			const next = { ...current, archivedAt: null, archiveReason: null, updatedAt: state.now() };
			state.cards.set(id, next);
			return { ...next };
		},
		async getConfig(id) {
			const found = state.cards.get(id);
			return found ? toCardConfig(found) : null;
		},
		async recordAvailable(id, availableCents, syncedAt, balanceCents) {
			const current = need(id);
			const next = {
				...current,
				availableCents: cleanAvailable(availableCents),
				// Saldo ausente na leitura grava null: o último, de outra rodada, enganaria a conferência do limite.
				balanceCents:
					balanceCents === undefined || balanceCents === null ? null : cleanAvailable(balanceCents),
				limitSyncedAt: syncedAt,
			};
			state.cards.set(id, next);
			return { ...next };
		},
	};
}
