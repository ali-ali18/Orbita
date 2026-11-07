import { MAX_CATEGORY_RULES } from "@orbita/shared";
import { type CategoryRuleStore, cleanRulePattern, RULE_LIMIT_MESSAGE } from "./category-rule-store.ts";
import type { Db } from "./client.ts";
import { badReference, invalid } from "./errors.ts";
import type { Clock } from "./memory-state.ts";
import { translate } from "./prisma-errors.ts";
import { checkReferences } from "./prisma-references.ts";

const toRecord = ({
	id,
	pattern,
	categoryId,
	createdAt,
}: {
	id: string;
	pattern: string;
	categoryId: string;
	createdAt: Date;
}) => ({ id, pattern, categoryId, createdAt });

export function createPrismaCategoryRuleStore(db: Db, now: Clock): CategoryRuleStore {
	return {
		async list() {
			const rows = await db.categoryRule.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
			return rows.map(toRecord);
		},
		async get(id) {
			const row = await db.categoryRule.findUnique({ where: { id } });
			return row ? toRecord(row) : null;
		},
		async upsert(pattern, categoryId) {
			const clean = cleanRulePattern(pattern);
			await checkReferences(db, { categoryId });
			try {
				const current = await db.categoryRule.findUnique({ where: { pattern: clean } });
				if (current) {
					return toRecord(await db.categoryRule.update({ where: { id: current.id }, data: { categoryId } }));
				}
				if ((await db.categoryRule.count()) >= MAX_CATEGORY_RULES) throw invalid(RULE_LIMIT_MESSAGE);
				return toRecord(
					await db.categoryRule.create({ data: { pattern: clean, categoryId, createdAt: now() } }),
				);
			} catch (e) {
				// Corrida no mesmo padrão: a outra chamada ganhou; vale a última categoria.
				if ((e as { code?: unknown } | null)?.code === "P2002") {
					const row = await db.categoryRule.update({ where: { pattern: clean }, data: { categoryId } });
					return toRecord(row);
				}
				throw translate(e, () => badReference());
			}
		},
		async delete(id) {
			const res = await db.categoryRule.deleteMany({ where: { id } });
			return res.count > 0;
		},
	};
}
