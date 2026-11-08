import { monthOf, toLocalDate } from "@orbita/core";
import {
	type AiUsageStore,
	type AiUsageTotals,
	DEFAULT_AI_MONTHLY_LIMIT_USD_CENTS,
} from "./ai-usage-store.ts";
import { checkUsageNumbers, cleanAiLimit } from "./chat-rules.ts";

/** Implementação em memória, para testes. Segue as mesmas regras da versão Prisma. */
export function createMemoryAiUsageStore(): AiUsageStore {
	const rows: Array<{ month: string } & AiUsageTotals> = [];
	let limit: number | null = DEFAULT_AI_MONTHLY_LIMIT_USD_CENTS;
	return {
		async record(input) {
			checkUsageNumbers(input);
			rows.push({
				month: monthOf(toLocalDate(input.at)),
				costMicroUsd: input.costMicroUsd,
				requests: 1,
				inputTokens: input.inputTokens,
				outputTokens: input.outputTokens,
				cacheReadTokens: input.cacheReadTokens,
				cacheWriteTokens: input.cacheWriteTokens,
			});
		},
		async monthTotals(month) {
			const total: AiUsageTotals = {
				costMicroUsd: 0,
				requests: 0,
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			};
			for (const row of rows) {
				if (row.month !== month) continue;
				total.costMicroUsd += row.costMicroUsd;
				total.requests += row.requests;
				total.inputTokens += row.inputTokens;
				total.outputTokens += row.outputTokens;
				total.cacheReadTokens += row.cacheReadTokens;
				total.cacheWriteTokens += row.cacheWriteTokens;
			}
			return total;
		},
		async getMonthlyLimit() {
			return limit;
		},
		async setMonthlyLimit(usdCents) {
			limit = cleanAiLimit(usdCents);
			return limit;
		},
	};
}
