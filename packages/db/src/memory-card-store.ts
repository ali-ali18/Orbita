import { randomUUID } from "node:crypto";
import { type CardStore, toCardConfig } from "./card-store.ts";
import { DataError, notFound } from "./errors.ts";
import { byCreated, type MemoryState } from "./memory-state.ts";
import { EXTERNAL_TAKEN_MESSAGE } from "./messages.ts";
import { applyPatch, normalizeCard, normalizeIdentity } from "./rules.ts";

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
				archivedAt: null,
				createdAt: now,
				updatedAt: now,
			};
			state.cards.set(record.id, record);
			return { ...record };
		},
		async update(id, patch) {
			const current = need(id);
			const next = { ...current, ...normalizeCard(applyPatch(current, patch)), updatedAt: state.now() };
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
		async getConfig(id) {
			const found = state.cards.get(id);
			return found ? toCardConfig(found) : null;
		},
	};
}
