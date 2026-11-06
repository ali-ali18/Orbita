import { randomUUID } from "node:crypto";
import { type CategoryRecord, type CategoryStore, DEFAULT_CATEGORIES } from "./category-store.ts";
import { DataError, invalid, notFound } from "./errors.ts";
import { byCreated, type MemoryState } from "./memory-state.ts";
import { SLUG_TAKEN_MESSAGE, SYSTEM_CATEGORY_MESSAGE } from "./messages.ts";
import { applyPatch, normalizeCategory } from "./rules.ts";

export function createMemoryCategoryStore(state: MemoryState): CategoryStore {
	const view = ({ createdAt: _created, ...rest }: CategoryRecord & { createdAt: Date }): CategoryRecord =>
		rest;
	const need = (id: string) => {
		const found = state.categories.get(id);
		if (!found) throw notFound("Categoria");
		return found;
	};
	const bySlug = (slug: string) => [...state.categories.values()].find((c) => c.slug === slug);
	const insert = (input: Parameters<typeof normalizeCategory>[0]) => {
		const data = normalizeCategory(input);
		if (bySlug(data.slug)) throw new DataError("duplicate", SLUG_TAKEN_MESSAGE);
		const record = { id: randomUUID(), ...data, archivedAt: null, createdAt: state.now() };
		state.categories.set(record.id, record);
		return record;
	};
	return {
		async list() {
			return [...state.categories.values()]
				.filter((c) => c.archivedAt === null)
				.sort(byCreated)
				.map(view);
		},
		async get(id) {
			const found = state.categories.get(id);
			return found ? view(found) : null;
		},
		async getBySlug(slug) {
			const found = bySlug(slug);
			return found ? view(found) : null;
		},
		async create(input) {
			return view(insert(input));
		},
		async update(id, patch) {
			const current = need(id);
			const next = {
				...current,
				...normalizeCategory(applyPatch<CategoryRecord>(current, patch)),
				slug: current.slug,
			};
			state.categories.set(id, next);
			return view(next);
		},
		async archive(id) {
			const current = need(id);
			if (current.isSystem) throw invalid(SYSTEM_CATEGORY_MESSAGE);
			if (current.archivedAt === null) state.categories.set(id, { ...current, archivedAt: state.now() });
			return view(need(id));
		},
		async ensureDefaults() {
			for (const def of DEFAULT_CATEGORIES) if (!bySlug(def.slug)) insert(def);
		},
	};
}
