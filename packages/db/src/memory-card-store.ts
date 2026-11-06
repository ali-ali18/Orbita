import { randomUUID } from "node:crypto";
import { type CardStore, toCardConfig } from "./card-store.ts";
import { notFound } from "./errors.ts";
import { byCreated, type MemoryState } from "./memory-state.ts";
import { applyPatch, normalizeCard } from "./rules.ts";

export function createMemoryCardStore(state: MemoryState): CardStore {
	const need = (id: string) => {
		const found = state.cards.get(id);
		if (!found) throw notFound("Cartão", "o");
		return found;
	};
	return {
		async create(input) {
			const now = state.now();
			const record = {
				id: randomUUID(),
				...normalizeCard(input),
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
		async getConfig(id) {
			const found = state.cards.get(id);
			return found ? toCardConfig(found) : null;
		},
	};
}
