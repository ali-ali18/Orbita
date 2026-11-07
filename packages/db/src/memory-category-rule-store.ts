import { randomUUID } from "node:crypto";
import { MAX_CATEGORY_RULES } from "@orbita/shared";
import {
	type CategoryRuleRecord,
	type CategoryRuleStore,
	cleanRulePattern,
	RULE_LIMIT_MESSAGE,
} from "./category-rule-store.ts";
import { invalid } from "./errors.ts";
import { assertRefs, byCreated, type MemoryState } from "./memory-state.ts";

export function createMemoryCategoryRuleStore(state: MemoryState): CategoryRuleStore {
	const view = (r: CategoryRuleRecord): CategoryRuleRecord => ({ ...r });
	return {
		async list() {
			return [...state.categoryRules.values()].sort(byCreated).map(view);
		},
		async get(id) {
			const found = state.categoryRules.get(id);
			return found ? view(found) : null;
		},
		async upsert(pattern, categoryId) {
			const clean = cleanRulePattern(pattern);
			assertRefs(state, { categoryId });
			const current = [...state.categoryRules.values()].find((r) => r.pattern === clean);
			if (current) {
				const next = { ...current, categoryId };
				state.categoryRules.set(current.id, next);
				return view(next);
			}
			if (state.categoryRules.size >= MAX_CATEGORY_RULES) throw invalid(RULE_LIMIT_MESSAGE);
			const record: CategoryRuleRecord = {
				id: randomUUID(),
				pattern: clean,
				categoryId,
				createdAt: state.now(),
			};
			state.categoryRules.set(record.id, record);
			return view(record);
		},
		async delete(id) {
			return state.categoryRules.delete(id);
		},
	};
}
