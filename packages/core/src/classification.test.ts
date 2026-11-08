import { describe, expect, it } from "vitest";
import {
	incomeDelta,
	investedDelta,
	spendingDelta,
	spendingMonthOf,
	summarizeMonth,
	type Transaction,
} from "./classification.ts";

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
		expect(summarizeMonth([], "2026-05")).toEqual({
			spentCents: 0,
			incomeCents: 0,
			investedCents: 0,
			projectedCents: 0,
			refundCreditCents: 0,
			byCategory: {},
		});
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
		expect(s).toEqual({
			spentCents: 5000,
			incomeCents: 300000,
			investedCents: 0,
			projectedCents: 0,
			refundCreditCents: 0,
			byCategory: { mercado: 5000 },
		});
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
	it("estorno maior que o gasto da categoria: categoria em 0, o excesso vira crédito, total nunca negativo", () => {
		const s = summarizeMonth(
			[
				{ id: "old", kind: "expense", amountCents: 8000, date: "2026-04-20", categoryId: "roupas" },
				tx({ kind: "expense", amountCents: 1000, date: "2026-05-02", categoryId: "mercado" }),
				tx({ kind: "expense", amountCents: 2000, date: "2026-05-03", categoryId: "roupas" }),
				tx({ kind: "refund", amountCents: 8000, date: "2026-05-09", refundOf: "old" }),
			],
			"2026-05",
		);
		expect(s.byCategory).toEqual({ roupas: 0, mercado: 1000 });
		expect(s.refundCreditCents).toBe(6000);
		expect(s.spentCents).toBe(1000);
	});
	it("estorno de categoria sem gasto no mês: tudo vira crédito e não cria categoria", () => {
		const s = summarizeMonth(
			[
				{ id: "old", kind: "expense", amountCents: 8000, date: "2026-04-20", categoryId: "roupas" },
				tx({ kind: "refund", amountCents: 8000, date: "2026-05-09", refundOf: "old" }),
			],
			"2026-05",
		);
		expect(s).toEqual({
			spentCents: 0,
			incomeCents: 0,
			investedCents: 0,
			projectedCents: 0,
			refundCreditCents: 8000,
			byCategory: {},
		});
	});
	it("spentCents sempre é a soma das categorias, qualquer que seja a ordem da lista", () => {
		const list: Transaction[] = [
			tx({ kind: "refund", amountCents: 500, date: "2026-05-01", categoryId: "a" }),
			tx({ kind: "expense", amountCents: 300, date: "2026-05-02", categoryId: "a" }),
			tx({ kind: "expense", amountCents: 900, date: "2026-05-03", categoryId: "b" }),
		];
		for (const l of [list, [...list].reverse()]) {
			const s = summarizeMonth(l, "2026-05");
			expect(s.spentCents).toBe(Object.values(s.byCategory).reduce((x, y) => x + y, 0));
			expect(s.spentCents).toBe(900);
			expect(s.refundCreditCents).toBe(200);
		}
	});
	it("budgetMonth inválido lança, mesmo em lançamento de outro mês", () => {
		for (const budgetMonth of ["2026-13", "2026-00", "2026-5", "junho", ""]) {
			const list = [tx({ kind: "expense", amountCents: 100, date: "2026-05-02", budgetMonth })];
			expect(() => summarizeMonth(list, "2026-05")).toThrow(RangeError);
			expect(() => summarizeMonth(list, "2026-07")).toThrow(RangeError);
		}
	});
	it("budgetMonth manda sobre a data", () => {
		const list: Transaction[] = [
			tx({ kind: "expense", amountCents: 100, date: "2026-05-02", budgetMonth: "2026-07", categoryId: "x" }),
		];
		expect(summarizeMonth(list, "2026-05").spentCents).toBe(0);
		expect(summarizeMonth(list, "2026-07").spentCents).toBe(100);
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
		expect(s.refundCreditCents).toBe(0);
	});
});

describe("summarizeMonth: o mês de quem tem rendimento, fatura paga, Pix e transferência própria", () => {
	// Mercado, Pix para terceiro, aplicação (saiu para investir) e uma compra no cartão são gasto; o resto não.
	const month = (extra: Transaction[] = []) =>
		summarizeMonth(
			[
				tx({ kind: "expense", amountCents: 25_000, date: "2026-11-03", categoryId: "mercado" }),
				tx({ kind: "expense", amountCents: 30_000, date: "2026-11-04", categoryId: "outros" }),
				// Compra no cartão: conta pela compra.
				tx({ kind: "expense", amountCents: 83_010, date: "2026-11-05", categoryId: "lazer" }),
				// Pix para terceiro (Rei Dos Coins): dinheiro que saiu de verdade.
				tx({ kind: "expense", amountCents: 9_000, date: "2026-11-06", categoryId: "transferencias" }),
				// Dinheiro enviado para investir: categoria própria, à parte do consumo.
				tx({ kind: "expense", amountCents: 20_000, date: "2026-11-07", categoryId: "investimentos" }),
				// Rendimento: receita em Investimentos, nunca gasto.
				tx({ kind: "income", amountCents: 320, date: "2026-11-08", categoryId: "investimentos" }),
				// Pagamento da fatura: as compras já contaram.
				tx({ kind: "card_payment", amountCents: 83_010, date: "2026-11-09", categoryId: "outros" }),
				// Entre contas do dono.
				tx({ kind: "transfer", amountCents: 50_000, date: "2026-11-10", categoryId: "transferencias" }),
				...extra,
			],
			"2026-11",
		);

	it("a quebra por categoria só tem despesa, e o total é a soma dela", () => {
		const s = month();
		expect(s.byCategory).toEqual({
			mercado: 25_000,
			outros: 30_000,
			lazer: 83_010,
			transferencias: 9_000,
			investimentos: 20_000,
		});
		expect(s.spentCents).toBe(167_010);
		expect(s.incomeCents).toBe(320);
		expect(s.refundCreditCents).toBe(0);
	});

	it("rendimento, pagamento de fatura e transferência própria não mudam o gasto de nenhuma categoria", () => {
		const withoutNoise = summarizeMonth(
			[
				tx({ kind: "expense", amountCents: 25_000, date: "2026-11-03", categoryId: "mercado" }),
				tx({ kind: "expense", amountCents: 9_000, date: "2026-11-06", categoryId: "transferencias" }),
			],
			"2026-11",
		);
		const noisy = summarizeMonth(
			[
				tx({ kind: "expense", amountCents: 25_000, date: "2026-11-03", categoryId: "mercado" }),
				tx({ kind: "expense", amountCents: 9_000, date: "2026-11-06", categoryId: "transferencias" }),
				tx({ kind: "income", amountCents: 999, date: "2026-11-08", categoryId: "investimentos" }),
				tx({ kind: "card_payment", amountCents: 70_000, date: "2026-11-09", categoryId: "transferencias" }),
				tx({ kind: "transfer", amountCents: 40_000, date: "2026-11-10", categoryId: "transferencias" }),
			],
			"2026-11",
		);
		expect(noisy.byCategory).toEqual(withoutNoise.byCategory);
		expect(noisy.spentCents).toBe(withoutNoise.spentCents);
	});

	it("estorno abate só a categoria da compra original", () => {
		const purchase = tx({ kind: "expense", amountCents: 12_000, date: "2026-11-11", categoryId: "lazer" });
		const s = month([
			purchase,
			tx({
				kind: "refund",
				amountCents: 2_000,
				date: "2026-11-12",
				refundOf: purchase.id,
				categoryId: "outros",
			}),
		]);
		expect(s.byCategory.lazer).toBe(83_010 + 10_000);
		expect(s.byCategory.outros).toBe(30_000);
		expect(s.spentCents).toBe(167_010 + 10_000);
	});
});

describe("gasto por fatura e investido (caso do dono)", () => {
	const M = "2026-11";
	// Fatura fechada que vence em novembro: parcelas e compras avulsas, de datas bem anteriores.
	const closed = [
		tx({
			kind: "expense",
			amountCents: 8687,
			date: "2026-09-12",
			budgetMonth: "2026-09",
			invoiceMonth: M,
			categoryId: "lazer",
		}),
		tx({
			kind: "expense",
			amountCents: 12464,
			date: "2026-10-03",
			budgetMonth: "2026-10",
			invoiceMonth: M,
			categoryId: "mercado",
		}),
		tx({
			kind: "expense",
			amountCents: 51000,
			date: "2026-10-20",
			budgetMonth: "2026-10",
			invoiceMonth: M,
			categoryId: "lazer",
		}),
	];
	// Fatura aberta (vence em dezembro): não pesa em novembro.
	const open = tx({
		kind: "expense",
		amountCents: 5150,
		date: "2026-11-05",
		invoiceMonth: "2026-12",
		categoryId: "mercado",
	});
	const invest = tx({
		kind: "investment",
		amountCents: 200000,
		date: "2026-11-04",
		categoryId: "investimentos",
	});
	const yieldIn = tx({ kind: "income", amountCents: 1234, date: "2026-11-06", categoryId: "investimentos" });
	const pixDebit = tx({ kind: "expense", amountCents: 3000, date: "2026-11-08", categoryId: "mercado" });

	it("Gasto = faturas que vencem no mês + conta por data; Investido à parte", () => {
		const s = summarizeMonth([...closed, open, invest, yieldIn], M);
		expect(s.spentCents).toBe(8687 + 12464 + 51000); // 72.151
		expect(s.investedCents).toBe(200000);
		expect(s.incomeCents).toBe(1234);
		expect(s.byCategory).toEqual({ lazer: 8687 + 51000, mercado: 12464 });
		expect(s.byCategory.investimentos).toBeUndefined();
	});
	it("todos os quatro itens de cartão vencendo no mês somam 773,01", () => {
		const four = [
			...closed,
			tx({ kind: "expense", amountCents: 5150, date: "2026-11-05", invoiceMonth: M, categoryId: "mercado" }),
		];
		// 86,87 + 124,64 + 510,00 + 51,50 = 773,01
		const s = summarizeMonth([...four, invest, yieldIn], M);
		expect(s.spentCents).toBe(77301);
		expect(s.investedCents).toBe(200000);
	});
	it("a fatura aberta pesa em dezembro, não em novembro", () => {
		expect(summarizeMonth([open], "2026-12").spentCents).toBe(5150);
		expect(summarizeMonth([open], M).spentCents).toBe(0);
	});
	it("débito/Pix continua pela data", () => {
		expect(summarizeMonth([pixDebit], M).spentCents).toBe(3000);
	});
	it("estorno no cartão acompanha a fatura", () => {
		const orig = tx({
			kind: "expense",
			amountCents: 10000,
			date: "2026-10-01",
			budgetMonth: "2026-10",
			invoiceMonth: M,
			categoryId: "lazer",
		});
		const refund = tx({
			kind: "refund",
			amountCents: 4000,
			date: "2026-11-20",
			invoiceMonth: M,
			refundOf: orig.id,
			categoryId: "lazer",
		});
		expect(summarizeMonth([orig, refund], M).spentCents).toBe(6000);
		const late = { ...refund, invoiceMonth: "2026-12" };
		expect(summarizeMonth([orig, late], M).spentCents).toBe(10000);
		expect(summarizeMonth([orig, late], "2026-12").refundCreditCents).toBe(4000);
	});
	it("parcela projetada conta no mês e vem separada", () => {
		const projected = tx({
			kind: "expense",
			amountCents: 9000,
			date: "2026-11-30",
			invoiceMonth: M,
			categoryId: "lazer",
			projected: true,
		});
		const s = summarizeMonth([...closed, projected], M);
		expect(s.spentCents).toBe(72151 + 9000);
		expect(s.projectedCents).toBe(9000);
	});
	it("spendingMonthOf e investedDelta", () => {
		expect(spendingMonthOf({ date: "2026-09-12", budgetMonth: "2026-09", invoiceMonth: M })).toBe(M);
		expect(spendingMonthOf({ date: "2026-09-12" })).toBe("2026-09");
		expect(investedDelta(invest)).toBe(200000);
		expect(spendingDelta(invest)).toBe(0);
		expect(incomeDelta(invest)).toBe(0);
	});
});
