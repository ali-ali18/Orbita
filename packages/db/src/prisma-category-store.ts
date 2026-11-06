import { type CategoryRecord, type CategoryStore, DEFAULT_CATEGORIES } from "./category-store.ts";
import type { Db } from "./client.ts";
import { DataError, invalid, notFound } from "./errors.ts";
import type { Clock } from "./memory-state.ts";
import { SLUG_TAKEN_MESSAGE, SYSTEM_CATEGORY_MESSAGE } from "./messages.ts";
import { translate } from "./prisma-errors.ts";
import { applyPatch, normalizeCategory } from "./rules.ts";

const toRecord = ({ id, slug, name, chartSlot, isSystem, archivedAt }: CategoryRecord): CategoryRecord => ({
	id,
	slug,
	name,
	chartSlot,
	isSystem,
	archivedAt,
});

export function createPrismaCategoryStore(db: Db, now: Clock): CategoryStore {
	const need = async (id: string) => {
		const found = await db.category.findUnique({ where: { id } });
		if (!found) throw notFound("Categoria");
		return found;
	};
	return {
		async list() {
			const rows = await db.category.findMany({
				where: { archivedAt: null },
				orderBy: [{ createdAt: "asc" }, { id: "asc" }],
			});
			return rows.map(toRecord);
		},
		async get(id) {
			const row = await db.category.findUnique({ where: { id } });
			return row ? toRecord(row) : null;
		},
		async getBySlug(slug) {
			const row = await db.category.findUnique({ where: { slug } });
			return row ? toRecord(row) : null;
		},
		async create(input) {
			const data = normalizeCategory(input);
			const at = now();
			try {
				return toRecord(await db.category.create({ data: { ...data, createdAt: at, updatedAt: at } }));
			} catch (e) {
				throw translate(e, () => new DataError("duplicate", SLUG_TAKEN_MESSAGE));
			}
		},
		async update(id, patch) {
			const current = await need(id);
			const { name, chartSlot } = normalizeCategory(applyPatch<CategoryRecord>(current, patch));
			return toRecord(
				await db.category.update({ where: { id }, data: { name, chartSlot, updatedAt: now() } }),
			);
		},
		async archive(id) {
			const current = await need(id);
			if (current.isSystem) throw invalid(SYSTEM_CATEGORY_MESSAGE);
			if (current.archivedAt !== null) return toRecord(current);
			const at = now();
			return toRecord(await db.category.update({ where: { id }, data: { archivedAt: at, updatedAt: at } }));
		},
		async ensureDefaults() {
			for (const def of DEFAULT_CATEGORIES) {
				const at = now();
				// `update: {}` deixa intacto o que o usuário já mudou.
				await db.category.upsert({
					where: { slug: def.slug },
					update: {},
					create: { ...normalizeCategory(def), createdAt: at, updatedAt: at },
				});
			}
		},
	};
}
