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
	const base = { budgetCents: 300000, spentCents: 0, pendingRecurringExpenseCents: 0 };
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
				pendingRecurringExpenseCents: 50000,
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
				pendingRecurringExpenseCents: 20000,
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
				pendingRecurringExpenseCents: 0,
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
	const zero = { spentCents: 0, pendingRecurringExpenseCents: 0, variableSpentCents: 0 };
	it("dia 1 com 1.000 gastos não projeta 31.000 e avisa baixa confiança", () => {
		const r = projectMonth({
			spentCents: 100000,
			pendingRecurringExpenseCents: 0,
			variableSpentCents: 100000,
			today: "2026-05-01",
			month: "2026-05",
		});
		expect(r.lowConfidence).toBe(true);
		expect(r.projectedCents).toBe(100000 + Math.round((100000 * 30) / 7));
		expect(r.projectedCents).toBeLessThan(3100000);
	});
	it("a partir do 7º dia usa o ritmo real e confia", () => {
		const day6 = projectMonth({ ...zero, variableSpentCents: 6000, today: "2026-05-06", month: "2026-05" });
		const day7 = projectMonth({ ...zero, variableSpentCents: 7000, today: "2026-05-07", month: "2026-05" });
		expect(day6.lowConfidence).toBe(true);
		expect(day6.projectedCents).toBe(Math.round((6000 * 25) / 7));
		expect(day7).toEqual({ projectedCents: (7000 * 24) / 7, lowConfidence: false });
	});
	it("último dia: sem dias restantes, projeção = gasto + despesas pendentes", () => {
		expect(
			projectMonth({
				spentCents: 90000,
				pendingRecurringExpenseCents: 500,
				variableSpentCents: 40000,
				today: "2026-05-31",
				month: "2026-05",
			}),
		).toEqual({ projectedCents: 90500, lowConfidence: false });
	});
	it("fevereiro: multiplica antes de dividir e arredonda uma vez", () => {
		// 10000 em 10 dias, 18 restantes → 18000
		const a = projectMonth({
			...zero,
			spentCents: 10000,
			variableSpentCents: 10000,
			today: "2026-02-10",
			month: "2026-02",
		});
		expect(a.projectedCents).toBe(10000 + 18000);
		// 101 * 18 / 10 = 181,8 → 182
		const b = projectMonth({
			...zero,
			spentCents: 101,
			variableSpentCents: 101,
			today: "2026-02-10",
			month: "2026-02",
		});
		expect(b.projectedCents).toBe(101 + 182);
	});
	it("sem gasto variável, só soma o que há", () => {
		expect(projectMonth({ ...zero, today: "2026-05-15", month: "2026-05" }).projectedCents).toBe(0);
	});
	it("estourado: projeção acima do orçamento é devolvida como está", () => {
		expect(
			projectMonth({
				spentCents: 200000,
				pendingRecurringExpenseCents: 100000,
				variableSpentCents: 200000,
				today: "2026-05-10",
				month: "2026-05",
			}).projectedCents,
		).toBe(200000 + 100000 + Math.round((200000 * 21) / 10));
	});
	it("valida mês e overflow", () => {
		expect(() => projectMonth({ ...zero, today: "2026-06-01", month: "2026-05" })).toThrow(RangeError);
		expect(() =>
			projectMonth({
				...zero,
				variableSpentCents: Number.MAX_SAFE_INTEGER,
				today: "2026-05-01",
				month: "2026-05",
			}),
		).toThrow(RangeError);
	});
});
