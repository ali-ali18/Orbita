import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_AI_MONTHLY_LIMIT_USD_CENTS } from "./ai-usage-store.ts";
import { contractSuites } from "./contract-harness.ts";
import type { Stores } from "./stores.ts";

const usage = (overrides: Partial<Parameters<Stores["aiUsage"]["record"]>[0]> = {}) => ({
	conversationId: null,
	model: "claude-sonnet-5-5",
	inputTokens: 1000,
	outputTokens: 200,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
	costMicroUsd: 4000,
	at: new Date("2026-11-15T15:00:00Z"),
	...overrides,
});

describe.each(contractSuites())("AiUsageStore (%s)", (_name, make) => {
	let stores: Stores;
	beforeEach(async () => {
		stores = await make();
	});

	it("mês sem uso soma zero", async () => {
		expect(await stores.aiUsage.monthTotals("2026-11")).toEqual({
			costMicroUsd: 0,
			requests: 0,
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		});
	});

	it("soma o mês em inteiros e separa os meses pelo fuso de São Paulo", async () => {
		await stores.aiUsage.record(usage());
		await stores.aiUsage.record(usage({ costMicroUsd: 1500, cacheReadTokens: 800, cacheWriteTokens: 50 }));
		// 01/12 02:00 UTC ainda é 30/11 em São Paulo (UTC-3).
		await stores.aiUsage.record(usage({ at: new Date("2026-12-01T02:00:00Z"), costMicroUsd: 7 }));
		await stores.aiUsage.record(usage({ at: new Date("2026-12-01T04:00:00Z"), costMicroUsd: 11 }));

		expect(await stores.aiUsage.monthTotals("2026-11")).toEqual({
			costMicroUsd: 4000 + 1500 + 7,
			requests: 3,
			inputTokens: 3000,
			outputTokens: 600,
			cacheReadTokens: 800,
			cacheWriteTokens: 50,
		});
		expect((await stores.aiUsage.monthTotals("2026-12")).costMicroUsd).toBe(11);
	});

	it("o custo sobrevive à conversa apagada", async () => {
		const c = await stores.chat.createConversation("Conversa");
		await stores.aiUsage.record(usage({ conversationId: c.id }));
		await stores.chat.deleteConversation(c.id);
		expect((await stores.aiUsage.monthTotals("2026-11")).costMicroUsd).toBe(4000);
	});

	it("recusa número fracionado, negativo ou grande demais", async () => {
		for (const bad of [
			{ costMicroUsd: 1.5 },
			{ inputTokens: -1 },
			{ outputTokens: Number.NaN },
			{ costMicroUsd: 3e9 },
		]) {
			await expect(stores.aiUsage.record(usage(bad))).rejects.toMatchObject({ code: "invalid" });
		}
		expect((await stores.aiUsage.monthTotals("2026-11")).requests).toBe(0);
	});

	it("limite mensal: padrão, troca, sem limite e validação", async () => {
		expect(await stores.aiUsage.getMonthlyLimit()).toBe(DEFAULT_AI_MONTHLY_LIMIT_USD_CENTS);
		expect(await stores.aiUsage.setMonthlyLimit(2500)).toBe(2500);
		expect(await stores.aiUsage.getMonthlyLimit()).toBe(2500);
		expect(await stores.aiUsage.setMonthlyLimit(0)).toBe(0);
		expect(await stores.aiUsage.setMonthlyLimit(null)).toBeNull();
		expect(await stores.aiUsage.getMonthlyLimit()).toBeNull();
		for (const bad of [-1, 1.5, 1_000_001, Number.NaN]) {
			await expect(stores.aiUsage.setMonthlyLimit(bad)).rejects.toMatchObject({ code: "invalid" });
		}
		expect(await stores.aiUsage.getMonthlyLimit()).toBeNull();
	});
});
