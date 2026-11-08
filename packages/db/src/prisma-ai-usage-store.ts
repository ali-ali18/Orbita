import { monthOf, toLocalDate } from "@orbita/core";
import { type AiUsageStore, DEFAULT_AI_MONTHLY_LIMIT_USD_CENTS } from "./ai-usage-store.ts";
import { checkUsageNumbers, cleanAiLimit } from "./chat-rules.ts";
import type { Db } from "./client.ts";
import { isForeignKeyViolation } from "./prisma-errors.ts";

const SETTINGS_ID = "main";

export function createPrismaAiUsageStore(db: Db): AiUsageStore {
	return {
		async record(input) {
			checkUsageNumbers(input);
			const data = {
				model: input.model.slice(0, 80),
				inputTokens: input.inputTokens,
				outputTokens: input.outputTokens,
				cacheReadTokens: input.cacheReadTokens,
				cacheWriteTokens: input.cacheWriteTokens,
				costMicroUsd: input.costMicroUsd,
				month: monthOf(toLocalDate(input.at)),
				createdAt: input.at,
			};
			try {
				await db.aiUsage.create({ data: { ...data, conversationId: input.conversationId } });
			} catch (error) {
				// A conversa foi apagada no meio da resposta: o custo continua valendo, sem vínculo.
				if (!isForeignKeyViolation(error) || input.conversationId === null) throw error;
				await db.aiUsage.create({ data: { ...data, conversationId: null } });
			}
		},
		async monthTotals(month) {
			const sum = await db.aiUsage.aggregate({
				where: { month },
				_sum: {
					costMicroUsd: true,
					inputTokens: true,
					outputTokens: true,
					cacheReadTokens: true,
					cacheWriteTokens: true,
				},
				_count: { _all: true },
			});
			return {
				costMicroUsd: sum._sum.costMicroUsd ?? 0,
				requests: sum._count._all,
				inputTokens: sum._sum.inputTokens ?? 0,
				outputTokens: sum._sum.outputTokens ?? 0,
				cacheReadTokens: sum._sum.cacheReadTokens ?? 0,
				cacheWriteTokens: sum._sum.cacheWriteTokens ?? 0,
			};
		},
		async getMonthlyLimit() {
			const row = await db.aiSettings.findUnique({ where: { id: SETTINGS_ID } });
			return row ? row.monthlyLimitUsdCents : DEFAULT_AI_MONTHLY_LIMIT_USD_CENTS;
		},
		async setMonthlyLimit(usdCents) {
			const monthlyLimitUsdCents = cleanAiLimit(usdCents);
			const row = await db.aiSettings.upsert({
				where: { id: SETTINGS_ID },
				update: { monthlyLimitUsdCents },
				create: { id: SETTINGS_ID, monthlyLimitUsdCents },
			});
			return row.monthlyLimitUsdCents;
		},
	};
}
