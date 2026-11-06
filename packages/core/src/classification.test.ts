import { describe, expect, it } from "vitest";
import { incomeDelta, spendingDelta, summarizeMonth, type Transaction } from "./classification.ts";

let n = 0;
function tx(partial: Partial<Transaction> & Pick<Transaction, "kind" | "amountCents" | "date">): Transaction {
	n += 1;
	return { id: `t${n}`, ...partial };
}

describe("spendingDelta / incomeDelta", () => {
	const base = { amountCents: 1000, date: "2026-05-10" };
	it("só despesa soma e só estorno subtrai", () => {
		expect(spendingDelta(tx({ ...base, kind: "expense" }))).toBe(1000);
		expect(spendingDelta(tx({ ...base, kind: "refund" }))).toBe(-1000);
		expect(spendingDelta(tx({ ...base, kind: "income" }))).toBe(0);
		expect(spendingDelta(tx({ ...base, kind: "transfer" }))).toBe(0);
		expect(spendingDelta(tx({ ...base, kind: "card_payment" }))).toBe(0);
	});
	it("só receita conta como renda", () => {
		expect(incomeDelta(tx({ ...base, kind: "income" }))).toBe(1000);
		for (const kind of ["expense", "refund", "transfer", "card_payment"] as const) {
			expect(incomeDelta(tx({ ...base, kind }))).toBe(0);
		}
	});
	it("rejeita valor não positivo ou fracionado", () => {
		expect(() => spendingDelta(tx({ kind: "expense", amountCents: 0, date: "2026-05-10" }))).toThrow(
			RangeError,
		);
		expect(() => spendingDelta(tx({ kind: "expense", amountCents: -5, date: "2026-05-10" }))).toThrow(
			RangeError,
		);
		expect(() => incomeDelta(tx({ kind: "income", amountCents: 1.5, date: "2026-05-10" }))).toThrow(
			RangeError,
		);
	});
});

describe("summarizeMonth", () => {
	it("mês vazio", () => {
		expect(summarizeMonth([], "2026-05")).toEqual({ spentCents: 0, incomeCents: 0, byCategory: {} });
	});
	it("pagamento de fatura e transferência não entram", () => {
		const s = summarizeMonth(
			[
				tx({ kind: "expense", amountCents: 5000, date: "2026-05-02", categoryId: "mercado" }),
				tx({ kind: "card_payment", amountCents: 90000, date: "2026-05-05" }),
				tx({ kind: "transfer", amountCents: 20000, date: "2026-05-06" }),
				tx({ kind: "income", amountCents: 300000, date: "2026-05-07" }),
			],
			"2026-05",
		);
		expect(s).toEqual({ spentCents: 5000, incomeCents: 300000, byCategory: { mercado: 5000 } });
	});
	it("despesa sem categoria vai para outros", () => {
		const s = summarizeMonth([tx({ kind: "expense", amountCents: 700, date: "2026-05-02" })], "2026-05");
		expect(s.byCategory).toEqual({ outros: 700 });
	});
	it("ignora lançamentos de outros meses", () => {
		const s = summarizeMonth(
			[
				tx({ kind: "expense", amountCents: 700, date: "2026-04-30" }),
				tx({ kind: "expense", amountCents: 100, date: "2026-06-01" }),
			],
			"2026-05",
		);
		expect(s.spentCents).toBe(0);
	});
	it("estorno abate a categoria da compra original", () => {
		const original = {
			id: "orig",
			kind: "expense",
			amountCents: 10000,
			date: "2026-05-02",
			categoryId: "roupas",
		} as const;
		const s = summarizeMonth(
			[
				original,
				tx({ kind: "expense", amountCents: 3000, date: "2026-05-03", categoryId: "mercado" }),
				tx({
					kind: "refund",
					amountCents: 4000,
					date: "2026-05-09",
					refundOf: "orig",
					categoryId: "mercado",
				}),
			],
			"2026-05",
		);
		expect(s.byCategory).toEqual({ roupas: 6000, mercado: 3000 });
		expect(s.spentCents).toBe(9000);
	});
	it("estorno de despesa de mês anterior reduz o gasto deste mês", () => {
		const s = summarizeMonth(
			[
				{ id: "old", kind: "expense", amountCents: 8000, date: "2026-04-20", categoryId: "roupas" },
				tx({ kind: "expense", amountCents: 10000, date: "2026-05-02", categoryId: "roupas" }),
				tx({ kind: "refund", amountCents: 8000, date: "2026-05-09", refundOf: "old" }),
			],
			"2026-05",
		);
		expect(s.spentCents).toBe(2000);
		expect(s.byCategory).toEqual({ roupas: 2000 });
	});
	it("estorno maior que o gasto da categoria: categoria trava em 0, total é o líquido real", () => {
		const s = summarizeMonth(
			[
				{ id: "old", kind: "expense", amountCents: 8000, date: "2026-04-20", categoryId: "roupas" },
				tx({ kind: "expense", amountCents: 1000, date: "2026-05-02", categoryId: "mercado" }),
				tx({ kind: "refund", amountCents: 8000, date: "2026-05-09", refundOf: "old" }),
			],
			"2026-05",
		);
		expect(s.byCategory).toEqual({ roupas: 0, mercado: 1000 });
		expect(s.spentCents).toBe(-7000);
	});
	it("estorno sem original na lista usa a própria categoria, depois outros", () => {
		const s = summarizeMonth(
			[
				tx({ kind: "expense", amountCents: 5000, date: "2026-05-02", categoryId: "casa" }),
				tx({ kind: "expense", amountCents: 5000, date: "2026-05-02" }),
				tx({ kind: "refund", amountCents: 1000, date: "2026-05-09", refundOf: "sumiu", categoryId: "casa" }),
				tx({ kind: "refund", amountCents: 500, date: "2026-05-09", refundOf: "sumiu" }),
			],
			"2026-05",
		);
		expect(s.byCategory).toEqual({ casa: 4000, outros: 4500 });
		expect(s.spentCents).toBe(8500);
	});
});
