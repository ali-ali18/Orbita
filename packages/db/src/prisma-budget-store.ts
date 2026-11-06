import { type BudgetStore, TOTAL_BUDGET_SCOPE } from "./budget-store.ts";
import type { Db } from "./client.ts";
import { invalid } from "./errors.ts";
import type { Clock } from "./memory-state.ts";
import { BUDGET_SCOPE_MESSAGE } from "./messages.ts";
import { cleanCents } from "./rules.ts";

const toRecord = ({
	scope,
	limitCents,
	updatedAt,
}: {
	scope: string;
	limitCents: number;
	updatedAt: Date;
}) => ({
	scope,
	limitCents,
	updatedAt,
});

export function createPrismaBudgetStore(db: Db, now: Clock): BudgetStore {
	return {
		async set(scope, limitCents) {
			const limit = cleanCents(limitCents, "O limite", 0);
			if (scope !== TOTAL_BUDGET_SCOPE && (await db.category.count({ where: { id: scope } })) === 0) {
				throw invalid(BUDGET_SCOPE_MESSAGE);
			}
			const at = now();
			return toRecord(
				await db.budget.upsert({
					where: { scope },
					update: { limitCents: limit, updatedAt: at },
					create: { scope, limitCents: limit, createdAt: at, updatedAt: at },
				}),
			);
		},
		async remove(scope) {
			const res = await db.budget.deleteMany({ where: { scope } });
			return res.count > 0;
		},
		async list() {
			const rows = await db.budget.findMany({ orderBy: [{ createdAt: "asc" }, { scope: "asc" }] });
			return rows.map(toRecord);
		},
	};
}
