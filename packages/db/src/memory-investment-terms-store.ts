import { notFound } from "./errors.ts";
import { isEmptyTerms, normalizeTerms } from "./investment-terms-rules.ts";
import type { InvestmentTermsRecord, InvestmentTermsStore } from "./investment-terms-store.ts";
import type { MemoryState } from "./memory-state.ts";

export function createMemoryInvestmentTermsStore(state: MemoryState): InvestmentTermsStore {
	return {
		async put(investmentId, input) {
			if (!state.investments.has(investmentId)) throw notFound("Investimento", "o");
			const data = normalizeTerms(input);
			if (isEmptyTerms(data)) {
				state.investmentTerms.delete(investmentId);
				return null;
			}
			const at = state.now();
			const current = state.investmentTerms.get(investmentId);
			const record: InvestmentTermsRecord = {
				investmentId,
				...data,
				createdAt: current?.createdAt ?? at,
				updatedAt: at,
			};
			state.investmentTerms.set(investmentId, record);
			return { ...record };
		},
		async get(investmentId) {
			const found = state.investmentTerms.get(investmentId);
			return found ? { ...found } : null;
		},
		async list() {
			return [...state.investmentTerms.values()]
				.sort((a, b) => a.investmentId.localeCompare(b.investmentId))
				.map((t) => ({ ...t }));
		},
	};
}
