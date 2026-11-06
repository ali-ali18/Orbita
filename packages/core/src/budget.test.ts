import { describe, expect, it } from "vitest";
import { budgetStatus, projectMonth, safeToSpend } from "./budget.ts";

describe("budgetStatus", () => {
	it("dentro do limite", () => {
		expect(budgetStatus({ limitCents: 10000, spentCents: 2500 })).toEqual({
			remainingCents: 7500,
			ratio: 0.25,
			overBudget: false,
		});
	});
	it("exatamente no limite não estoura", () => {
		expect(budgetStatus({ limitCents: 10000, spentCents: 10000 })).toEqual({
			remainingCents: 0,
			ratio: 1,
			overBudget: false,
		});
	});
	it("estourado", () => {
		expect(budgetStatus({ limitCents: 10000, spentCents: 15000 })).toEqual({
			remainingCents: -5000,
			ratio: 1.5,
			overBudget: true,
		});
	});
	it("limite zero", () => {
		expect(budgetStatus({ limitCents: 0, spentCents: 0 })).toEqual({
			remainingCents: 0,
			ratio: 0,
			overBudget: false,
		});
		expect(budgetStatus({ limitCents: 0, spentCents: 1 }).overBudget).toBe(true);
		expect(budgetStatus({ limitCents: 0, spentCents: 1 }).ratio).toBe(Number.POSITIVE_INFINITY);
	});
	it("rejeita limite negativo e fração", () => {
		expect(() => budgetStatus({ limitCents: -1, spentCents: 0 })).toThrow(RangeError);
		expect(() => budgetStatus({ limitCents: 100, spentCents: 0.5 })).toThrow(RangeError);
	});
});

describe("safeToSpend", () => {
	const base = { budgetCents: 300000, spentCents: 0, pendingRecurringCents: 0 };
	it("primeiro dia: divide pelo mês inteiro", () => {
		expect(safeToSpend({ ...base, today: "2026-05-01", month: "2026-05" })).toEqual({
			availableCents: 300000,
			perDayCents: 9677,
			remainingDays: 31,
		});
	});
	it("último dia: um dia restante (hoje)", () => {
		expect(
			safeToSpend({
				...base,
				spentCents: 100000,
				pendingRecurringCents: 50000,
				today: "2026-05-31",
				month: "2026-05",
			}),
		).toEqual({ availableCents: 150000, perDayCents: 150000, remainingDays: 1 });
	});
	it("fevereiro, comum e bissexto", () => {
		expect(safeToSpend({ ...base, today: "2026-02-01", month: "2026-02" }).remainingDays).toBe(28);
		expect(safeToSpend({ ...base, today: "2024-02-01", month: "2024-02" }).remainingDays).toBe(29);
		expect(safeToSpend({ ...base, today: "2024-02-29", month: "2024-02" }).remainingDays).toBe(1);
	});
	it("estourado: disponível negativo e por dia zero", () => {
		expect(
			safeToSpend({
				...base,
				spentCents: 290000,
				pendingRecurringCents: 20000,
				today: "2026-05-10",
				month: "2026-05",
			}),
		).toEqual({ availableCents: -10000, perDayCents: 0, remainingDays: 22 });
	});
	it("disponível zero → por dia zero; arredonda para baixo", () => {
		expect(
			safeToSpend({ ...base, spentCents: 300000, today: "2026-05-10", month: "2026-05" }).perDayCents,
		).toBe(0);
		expect(
			safeToSpend({
				budgetCents: 100,
				spentCents: 0,
				pendingRecurringCents: 0,
				today: "2026-05-01",
				month: "2026-05",
			}).perDayCents,
		).toBe(3);
	});
	it("exige que hoje esteja no mês", () => {
		expect(() => safeToSpend({ ...base, today: "2026-06-01", month: "2026-05" })).toThrow(RangeError);
	});
});

describe("projectMonth", () => {
	it("primeiro dia: extrapola o gasto variável de um dia", () => {
		expect(
			projectMonth({
				spentCents: 1000,
				pendingRecurringCents: 5000,
				variableSpentCents: 1000,
				today: "2026-05-01",
				month: "2026-05",
			}),
		).toBe(1000 + 5000 + 1000 * 30);
	});
	it("último dia: sem dias restantes, projeção = gasto + pendente", () => {
		expect(
			projectMonth({
				spentCents: 90000,
				pendingRecurringCents: 0,
				variableSpentCents: 40000,
				today: "2026-05-31",
				month: "2026-05",
			}),
		).toBe(90000);
	});
	it("fevereiro: multiplica antes de dividir e arredonda uma vez", () => {
		// 10000 em 10 dias, 18 restantes → 18000
		expect(
			projectMonth({
				spentCents: 10000,
				pendingRecurringCents: 0,
				variableSpentCents: 10000,
				today: "2026-02-10",
				month: "2026-02",
			}),
		).toBe(10000 + 18000);
		// 100 * 18 / 10 = 180 exato; 101 * 18 / 10 = 181,8 → 182
		expect(
			projectMonth({
				spentCents: 101,
				pendingRecurringCents: 0,
				variableSpentCents: 101,
				today: "2026-02-10",
				month: "2026-02",
			}),
		).toBe(101 + 182);
	});
	it("sem gasto variável, só soma o que há", () => {
		expect(
			projectMonth({
				spentCents: 0,
				pendingRecurringCents: 0,
				variableSpentCents: 0,
				today: "2026-05-15",
				month: "2026-05",
			}),
		).toBe(0);
	});
	it("estourado: projeção acima do orçamento é devolvida como está", () => {
		expect(
			projectMonth({
				spentCents: 200000,
				pendingRecurringCents: 100000,
				variableSpentCents: 200000,
				today: "2026-05-10",
				month: "2026-05",
			}),
		).toBe(200000 + 100000 + Math.round((200000 * 21) / 10));
	});
	it("valida mês e overflow", () => {
		const args = { spentCents: 0, pendingRecurringCents: 0, variableSpentCents: 0 };
		expect(() => projectMonth({ ...args, today: "2026-06-01", month: "2026-05" })).toThrow(RangeError);
		expect(() =>
			projectMonth({
				...args,
				variableSpentCents: Number.MAX_SAFE_INTEGER,
				today: "2026-05-01",
				month: "2026-05",
			}),
		).toThrow(RangeError);
	});
});
