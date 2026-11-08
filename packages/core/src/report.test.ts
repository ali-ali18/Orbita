import { describe, expect, it } from "vitest";
import { summarizeMonth } from "./classification.ts";
import { invoiceComposition } from "./invoice-composition.ts";
import { monthReport, percentChange, type ReportTransaction } from "./report.ts";

let n = 0;
const tx = (over: Partial<ReportTransaction> & Pick<ReportTransaction, "kind" | "amountCents" | "date">) =>
	({ id: `t${++n}`, description: `lançamento ${n}`, ...over }) as ReportTransaction;

const base = {
	recurringTransactionIds: new Set<string>(),
	budgets: [],
	invoices: [],
};

describe("percentChange", () => {
	it("é inteira, simétrica e nula sem referência", () => {
		expect(percentChange(8800, 10000)).toBe(-12);
		expect(percentChange(11200, 10000)).toBe(12);
		expect(percentChange(10250, 10000)).toBe(3);
		expect(percentChange(9750, 10000)).toBe(-3);
		expect(percentChange(500, 0)).toBeNull();
		expect(percentChange(0, 0)).toBeNull();
	});
	it("recusa centavo fracionário", () => {
		expect(() => percentChange(1.5, 100)).toThrow();
	});
});

describe("monthReport", () => {
	const txs = [
		tx({ kind: "income", amountCents: 420000, date: "2026-10-05" }),
		tx({ kind: "income", amountCents: 420000, date: "2026-09-05" }),
		tx({ id: "m10", kind: "expense", amountCents: 98000, date: "2026-10-10", categoryId: "mercado" }),
		tx({ id: "d10", kind: "expense", amountCents: 52000, date: "2026-10-12", categoryId: "delivery" }),
		tx({ id: "n10", kind: "expense", amountCents: 26200, date: "2026-10-15", categoryId: "assinaturas" }),
		tx({ id: "l10", kind: "expense", amountCents: 24000, date: "2026-10-20", categoryId: "lazer" }),
		tx({ kind: "card_payment", amountCents: 300000, date: "2026-10-08" }),
		tx({ kind: "transfer", amountCents: 100000, date: "2026-10-09" }),
		tx({ id: "m09", kind: "expense", amountCents: 111364, date: "2026-09-10", categoryId: "mercado" }),
		tx({ id: "d09", kind: "expense", amountCents: 38806, date: "2026-09-12", categoryId: "delivery" }),
		tx({ id: "n09", kind: "expense", amountCents: 21653, date: "2026-09-15", categoryId: "assinaturas" }),
		tx({ id: "l09", kind: "expense", amountCents: 40678, date: "2026-09-20", categoryId: "lazer" }),
		// Julho sem movimento algum: não entra na média.
		tx({ kind: "income", amountCents: 400000, date: "2026-08-05" }),
		tx({ kind: "expense", amountCents: 90000, date: "2026-08-10", categoryId: "mercado" }),
	];
	const report = monthReport({
		...base,
		month: "2026-10",
		transactions: txs,
		recurringTransactionIds: new Set(["n10", "n09"]),
	});

	it("totais batem com o engine e pagar fatura/transferir não é gasto", () => {
		const engine = summarizeMonth(txs, "2026-10");
		expect(report.totals.spentCents).toBe(engine.spentCents);
		expect(report.totals).toEqual({
			incomeCents: 420000,
			spentCents: 200200,
			investedCents: 0,
			balanceCents: 219800,
			refundCreditCents: 0,
		});
		expect(report.closedOn).toBe("2026-11-01");
	});

	it("compara com o mês anterior", () => {
		expect(report.vsPrevious?.months).toEqual(["2026-09"]);
		expect(report.vsPrevious?.income).toEqual({ referenceCents: 420000, deltaCents: 0, percent: 0 });
		expect(report.vsPrevious?.spent).toEqual({ referenceCents: 212501, deltaCents: -12301, percent: -6 });
	});

	it("compara com a média dos meses anteriores que tiveram movimento", () => {
		expect(report.vsAverage?.months).toEqual(["2026-09", "2026-08"]);
		// média de gasto: (212501 + 90000) / 2 = 151250,5 -> 151251
		expect(report.vsAverage?.spent.referenceCents).toBe(151251);
		expect(report.vsAverage?.spent.deltaCents).toBe(200200 - 151251);
		expect(report.vsAverage?.income.referenceCents).toBe(410000);
	});

	it("sem mês anterior nem histórico, não há comparação", () => {
		const r = monthReport({
			...base,
			month: "2026-10",
			transactions: [tx({ kind: "expense", amountCents: 1000, date: "2026-10-01", categoryId: "mercado" })],
		});
		expect(r.vsPrevious).toBeNull();
		expect(r.vsAverage).toBeNull();
		expect(r.totals.balanceCents).toBe(-1000);
	});

	it("categorias: maiores primeiro, com variação contra o mês anterior", () => {
		expect(report.topCategories.map((c) => c.categoryId)).toEqual([
			"mercado",
			"delivery",
			"assinaturas",
			"lazer",
		]);
		const delivery = report.topCategories[1];
		expect(delivery).toMatchObject({
			spentCents: 52000,
			previousCents: 38806,
			deltaCents: 13194,
			percent: 34,
		});
		expect(report.topCategories[0]?.sharePercent).toBe(49);
		expect(report.topCategories[3]?.percent).toBe(-41);
	});

	it("categoria que sumiu no mês aparece com -100%; o limite corta a lista", () => {
		const r = monthReport({
			...base,
			month: "2026-10",
			topCategories: 2,
			transactions: [
				tx({ kind: "expense", amountCents: 500, date: "2026-10-01", categoryId: "a" }),
				tx({ kind: "expense", amountCents: 900, date: "2026-09-01", categoryId: "gone" }),
				tx({ kind: "expense", amountCents: 100, date: "2026-10-02", categoryId: "b" }),
			],
		});
		expect(r.topCategories.map((c) => c.categoryId)).toEqual(["a", "b"]);
		const all = monthReport({
			...base,
			month: "2026-10",
			transactions: [
				tx({ kind: "expense", amountCents: 900, date: "2026-09-01", categoryId: "gone" }),
				tx({ kind: "expense", amountCents: 100, date: "2026-10-02", categoryId: "b" }),
			],
		});
		expect(all.topCategories.find((c) => c.categoryId === "gone")).toMatchObject({
			spentCents: 0,
			percent: -100,
		});
	});

	it("maiores despesas só do mês, por valor", () => {
		expect(report.biggestExpenses.map((e) => e.id)).toEqual(["m10", "d10", "n10", "l10"]);
		expect(report.biggestExpenses[0]).toMatchObject({ amountCents: 98000, categoryId: "mercado" });
	});

	it("assinaturas: total do mês e variação", () => {
		expect(report.subscriptions).toEqual({
			totalCents: 26200,
			count: 1,
			change: { referenceCents: 21653, deltaCents: 4547, percent: 21 },
		});
	});

	it("orçamento: aderência por limite", () => {
		const r = monthReport({
			...base,
			month: "2026-10",
			transactions: txs,
			budgets: [
				{ categoryId: null, limitCents: 250000 },
				{ categoryId: "delivery", limitCents: 40000 },
				{ categoryId: "mercado", limitCents: 98000 },
				{ categoryId: "lazer", limitCents: 0 },
			],
		});
		expect(r.budget.rows.map((x) => [x.categoryId, x.overBudget, x.remainingCents])).toEqual([
			[null, false, 49800],
			["delivery", true, -12000],
			["mercado", false, 0],
			["lazer", true, -24000],
		]);
		expect(r.budget.rows[3]?.ratio).toBeNull();
		expect(r.budget).toMatchObject({ withinCount: 2, overCount: 2, adherencePercent: 50 });
		expect(report.budget.adherencePercent).toBeNull();
	});

	it("faturas por cartão somam o total", () => {
		const a = invoiceComposition([{ id: "1", kind: "expense", amountCents: 10000 }]);
		const b = invoiceComposition([
			{ id: "2", kind: "expense", amountCents: 5000 },
			{ id: "3", kind: "refund", amountCents: 1000 },
		]);
		const r = monthReport({
			...base,
			month: "2026-10",
			transactions: [],
			invoices: [
				{ cardId: "a", composition: a },
				{ cardId: "b", composition: b },
			],
		});
		expect(r.invoices.totalCents).toBe(14000);
		expect(r.invoices.cards.map((c) => [c.cardId, c.totalCents])).toEqual([
			["a", 10000],
			["b", 4000],
		]);
	});

	it("estorno de outro mês abate a categoria e a atravessada de ano funciona", () => {
		const buy = tx({ id: "buy", kind: "expense", amountCents: 10000, date: "2026-12-20", categoryId: "x" });
		const r = monthReport({
			...base,
			month: "2027-01",
			transactions: [
				buy,
				tx({ kind: "refund", amountCents: 4000, date: "2027-01-03", refundOf: "buy" }),
				tx({ kind: "expense", amountCents: 6000, date: "2027-01-04", categoryId: "x" }),
			],
		});
		expect(r.totals.spentCents).toBe(2000);
		expect(r.vsPrevious?.months).toEqual(["2026-12"]);
		expect(r.closedOn).toBe("2027-02-01");
	});

	it("mês inválido é recusado", () => {
		expect(() => monthReport({ ...base, month: "2026-13", transactions: [] })).toThrow();
	});
});

describe("monthReport: gasto pela data da compra e investido", () => {
	const txs = [
		// Compras de novembro no cartão (faturas de novembro e dezembro) e na conta.
		tx({
			kind: "expense",
			amountCents: 51000,
			date: "2026-11-02",
			invoiceMonth: "2026-12",
			categoryId: "lazer",
		}),
		tx({
			kind: "expense",
			amountCents: 8687,
			date: "2026-11-03",
			invoiceMonth: "2026-12",
			categoryId: "lazer",
		}),
		tx({ kind: "expense", amountCents: 5150, date: "2026-11-12", categoryId: "mercado" }),
		tx({ kind: "investment", amountCents: 200000, date: "2026-11-04", categoryId: "investimentos" }),
		tx({ kind: "income", amountCents: 1234, date: "2026-11-06", categoryId: "investimentos" }),
		// Outubro: compra de cartão cuja fatura vence em novembro NÃO é gasto de novembro.
		tx({
			kind: "expense",
			amountCents: 30000,
			date: "2026-10-30",
			budgetMonth: "2026-10",
			invoiceMonth: "2026-11",
			categoryId: "lazer",
		}),
		tx({ kind: "expense", amountCents: 10000, date: "2026-10-20", categoryId: "mercado" }),
		tx({ kind: "investment", amountCents: 50000, date: "2026-10-04", categoryId: "investimentos" }),
	];
	const report = monthReport({ ...base, month: "2026-11", transactions: txs });

	it("totais pela data; investido fora do gasto e do saldo", () => {
		expect(report.totals).toEqual({
			incomeCents: 1234,
			spentCents: 64837,
			investedCents: 200000,
			balanceCents: 1234 - 64837,
			refundCreditCents: 0,
		});
		expect(report.topCategories.map((c) => c.categoryId)).toEqual(["lazer", "mercado"]);
		expect(report.topCategories[1]).toMatchObject({
			categoryId: "mercado",
			spentCents: 5150,
			previousCents: 10000,
		});
	});

	it("maiores despesas seguem o mês da compra", () => {
		expect(report.biggestExpenses.map((e) => e.amountCents)).toEqual([51000, 8687, 5150]);
	});

	it("o investido não entra na comparação do gasto", () => {
		expect(report.vsPrevious?.spent).toMatchObject({ referenceCents: 40000, deltaCents: 24837 });
	});
});
