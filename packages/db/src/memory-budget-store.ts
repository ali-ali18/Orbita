import { type BudgetStore, TOTAL_BUDGET_SCOPE } from "./budget-store.ts";
import { invalid } from "./errors.ts";
import { byCreated, type MemoryState } from "./memory-state.ts";
import { BUDGET_SCOPE_MESSAGE } from "./messages.ts";
import { cleanCents } from "./rules.ts";

export function createMemoryBudgetStore(state: MemoryState): BudgetStore {
	const view = ({
		createdAt: _created,
		...record
	}: {
		scope: string;
		limitCents: number;
		updatedAt: Date;
		createdAt: Date;
	}) => record;
	return {
		async set(scope, limitCents) {
			const limit = cleanCents(limitCents, "O limite", 0);
			if (scope !== TOTAL_BUDGET_SCOPE && !state.categories.has(scope)) throw invalid(BUDGET_SCOPE_MESSAGE);
			const now = state.now();
			const current = state.budgets.get(scope);
			const next = { scope, limitCents: limit, updatedAt: now, createdAt: current?.createdAt ?? now };
			state.budgets.set(scope, next);
			return view(next);
		},
		async remove(scope) {
			return state.budgets.delete(scope);
		},
		async list() {
			return [...state.budgets.values()]
				.sort((a, b) => byCreated({ ...a, id: a.scope }, { ...b, id: b.scope }))
				.map(view);
		},
	};
}
