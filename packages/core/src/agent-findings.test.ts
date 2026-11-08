import { describe, expect, it } from "vitest";
import { closeMonth, type GoalFacts, goalsBehindPace, suggestSaving } from "./agent-findings.ts";
import { summarizeGoal } from "./goals.ts";
import { monthReport, type ReportTransaction } from "./report.ts";

describe("goalsBehindPace", () => {
	const facts = (name: string, over: Parameters<typeof summarizeGoal>[0]): GoalFacts => {
		const s = summarizeGoal(over, "2026-11-08");
		return { id: name, name, targetCents: over.targetCents, deadline: over.deadline, ...s };
	};
	it("separa só as atrasadas, com o que falta por mês além do ritmo", () => {
		const behind = facts("Notebook", {
			targetCents: 600000,
			deadline: "2027-02-28",
			createdOn: "2026-08-01",
			contributions: [{ amountCents: 90000, date: "2026-09-10" }],
		});
		const onTrack = facts("Chile", {
			targetCents: 100000,
			deadline: "2027-12-31",
			createdOn: "2026-08-01",
			contributions: [{ amountCents: 90000, date: "2026-10-10" }],
		});
		const noDeadline = facts("Reserva", {
			targetCents: 100000,
			deadline: null,
			createdOn: "2026-08-01",
			contributions: [],
		});
		expect(behind.status).toBe("behind");
		expect(onTrack.status).toBe("on_track");
		const found = goalsBehindPace([onTrack, behind, noDeadline]);
		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({
			goalId: "Notebook",
			monthlyNeededCents: behind.monthlyNeededCents,
			paceCents: behind.paceCents,
			gapPerMonthCents: (behind.monthlyNeededCents ?? 0) - behind.paceCents,
		});
	});
});

describe("suggestSaving", () => {
	it("sugere a sobra projetada, para baixo em R$ 10, sem mover nada", () => {
		expect(
			suggestSaving({ budgetCents: 400000, projectedCents: 358765, lowConfidence: false, minCents: 10000 }),
		).toEqual({
			leftoverCents: 41235,
			suggestedCents: 41000,
			budgetCents: 400000,
			projectedCents: 358765,
			lowConfidence: false,
		});
	});
	it("não sugere sem orçamento, sem projeção, no vermelho ou abaixo do mínimo", () => {
		const base = { lowConfidence: false, minCents: 10000 };
		expect(suggestSaving({ ...base, budgetCents: null, projectedCents: 1000 })).toBeNull();
		expect(suggestSaving({ ...base, budgetCents: 1000, projectedCents: null })).toBeNull();
		expect(suggestSaving({ ...base, budgetCents: 400000, projectedCents: 420000 })).toBeNull();
		expect(suggestSaving({ ...base, budgetCents: 400000, projectedCents: 395000 })).toBeNull();
	});
	it("o mínimo nunca é menor que o arredondamento", () => {
		expect(
			suggestSaving({ budgetCents: 1500, projectedCents: 1000, lowConfidence: true, minCents: 100 }),
		).toBeNull();
		expect(
			suggestSaving({ budgetCents: 2500, projectedCents: 1000, lowConfidence: true, minCents: 100 }),
		).toMatchObject({ suggestedCents: 1000, lowConfidence: true });
	});
});

describe("closeMonth", () => {
	let n = 0;
	const tx = (over: Partial<ReportTransaction> & Pick<ReportTransaction, "kind" | "amountCents" | "date">) =>
		({ id: `t${++n}`, description: `lançamento ${n}`, ...over }) as ReportTransaction;
	const input = {
		recurringTransactionIds: new Set<string>(),
		budgets: [{ categoryId: "mercado", limitCents: 90000 }],
		invoices: [],
	};
	it("resume o relatório do engine", () => {
		const report = monthReport({
			...input,
			month: "2026-10",
			transactions: [
				tx({ kind: "income", amountCents: 420000, date: "2026-10-05" }),
				tx({ kind: "expense", amountCents: 98000, date: "2026-10-10", categoryId: "mercado" }),
				tx({ kind: "expense", amountCents: 52000, date: "2026-10-12", categoryId: "delivery" }),
				tx({ kind: "expense", amountCents: 80000, date: "2026-09-10", categoryId: "mercado" }),
				tx({ kind: "income", amountCents: 400000, date: "2026-09-05" }),
			],
		});
		const closing = closeMonth(report);
		expect(closing).toMatchObject({
			month: "2026-10",
			incomeCents: 420000,
			spentCents: 150000,
			balanceCents: 270000,
			leftoverCents: 270000,
			spentDeltaCents: 70000,
			overBudgetCount: 1,
		});
		expect(closing?.spentChangePercent).toBe(88);
		expect(closing?.topCategories.map((c) => c.categoryId)).toEqual(["mercado", "delivery"]);
	});
	it("mês no vermelho não tem sobra, e mês sem movimento não fecha", () => {
		const red = monthReport({
			...input,
			month: "2026-10",
			transactions: [tx({ kind: "expense", amountCents: 50000, date: "2026-10-10", categoryId: "mercado" })],
		});
		expect(closeMonth(red)).toMatchObject({ balanceCents: -50000, leftoverCents: 0, spentDeltaCents: null });
		expect(closeMonth(monthReport({ ...input, month: "2026-10", transactions: [] }))).toBeNull();
	});
});
