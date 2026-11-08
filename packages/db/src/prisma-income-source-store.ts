import type { Db } from "./client.ts";
import { invalid, notFound } from "./errors.ts";
import type { IncomeSourceRecord, IncomeSourceStore } from "./income-source-store.ts";
import type { Clock } from "./memory-state.ts";
import { INCOME_ARCHIVED_MESSAGE } from "./messages.ts";
import { checkReferences } from "./prisma-references.ts";
import { applyPatch, normalizeIncomeSource } from "./rules.ts";

export function createPrismaIncomeSourceStore(db: Db, now: Clock): IncomeSourceStore {
	const need = async (id: string): Promise<IncomeSourceRecord> => {
		const found = await db.incomeSource.findUnique({ where: { id } });
		if (!found) throw notFound("Renda");
		return found;
	};
	return {
		async create(input) {
			const data = normalizeIncomeSource(input);
			const accountId = input.accountId ?? null;
			await checkReferences(db, { accountIds: [accountId] });
			const at = now();
			return db.incomeSource.create({ data: { ...data, accountId, createdAt: at, updatedAt: at } });
		},
		async update(id, patch) {
			const current = await need(id);
			if (current.archivedAt !== null) throw invalid(INCOME_ARCHIVED_MESSAGE);
			const merged = applyPatch(current, patch);
			const data = normalizeIncomeSource(merged);
			await checkReferences(db, { accountIds: [merged.accountId] }, { accountIds: [current.accountId] });
			return db.incomeSource.update({
				where: { id },
				data: { ...data, accountId: merged.accountId, updatedAt: now() },
			});
		},
		async archive(id) {
			const current = await need(id);
			if (current.archivedAt !== null) return current;
			const at = now();
			return db.incomeSource.update({ where: { id }, data: { archivedAt: at, updatedAt: at } });
		},
		async list() {
			return db.incomeSource.findMany({
				where: { archivedAt: null },
				orderBy: [{ createdAt: "asc" }, { id: "asc" }],
			});
		},
		async get(id) {
			return db.incomeSource.findUnique({ where: { id } });
		},
	};
}
