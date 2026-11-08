import { describe, expect, it } from "vitest";
import { medianCents, merchantKey } from "./merchant.ts";
import {
	detectBudgetThresholds,
	detectDuplicateCharges,
	detectUnusualSpending,
	type WatchedSpend,
} from "./watch.ts";

let n = 0;
const spend = (over: Partial<WatchedSpend> & Pick<WatchedSpend, "date" | "amountCents">): WatchedSpend => ({
	id: `t${++n}`,
	categoryId: "bar",
	merchant: "Bar do Zé",
	...over,
});

describe("merchantKey e medianCents", () => {
	it("tira acento, pontuação e números soltos e guarda as primeiras palavras", () => {
		expect(merchantKey("IFOOD *Restaurante São João 12/10")).toBe("ifood restaurante");
		expect(merchantKey("NETFLIX.COM", 1)).toBe("netflix");
		expect(merchantKey("Netflix", 1)).toBe("netflix");
		expect(merchantKey("  123  ")).toBe("");
		expect(merchantKey(null)).toBe("");
	});
	it("mediana inteira", () => {
		expect(medianCents([])).toBe(0);
		expect(medianCents([5, 1, 3])).toBe(3);
		expect(medianCents([1, 2, 3, 4])).toBe(2);
		expect(medianCents([100, 101])).toBe(100);
		expect(() => medianCents([1.5])).toThrow();
	});
});

describe("detectUnusualSpending", () => {
	const history = [4000, 5000, 6000, 5500, 4500, 90000].map((amountCents, i) =>
		spend({ id: `h${i}`, amountCents, date: `2026-10-0${i + 1}` }),
	);
	it("avisa quando passa de 3x a mediana e do piso", () => {
		// Mediana de [4000,4500,5000,5500,6000,90000] = 5250; 3x = 15750.
		const big = spend({ id: "big", amountCents: 20000, date: "2026-11-07" });
		const found = detectUnusualSpending({ recent: [big], history, minCents: 10000 });
		expect(found).toEqual([
			{
				transactionId: "big",
				categoryId: "bar",
				date: "2026-11-07",
				merchant: "Bar do Zé",
				amountCents: 20000,
				medianCents: 5250,
				sampleCount: 6,
			},
		]);
	});
	it("a compra grande antiga não distorce o usual (mediana, não média)", () => {
		const mid = spend({ id: "mid", amountCents: 16000, date: "2026-11-07" });
		expect(detectUnusualSpending({ recent: [mid], history, minCents: 10000 })).toHaveLength(1);
	});
	it("respeita o piso, o fator e o mínimo de amostras", () => {
		const justUnder = spend({ amountCents: 15750, date: "2026-11-07" });
		expect(detectUnusualSpending({ recent: [justUnder], history, minCents: 1000 })).toEqual([]);
		const big = spend({ amountCents: 20000, date: "2026-11-07" });
		expect(detectUnusualSpending({ recent: [big], history, minCents: 30000 })).toEqual([]);
		expect(detectUnusualSpending({ recent: [big], history: history.slice(0, 4), minCents: 1000 })).toEqual(
			[],
		);
	});
	it("ignora sem categoria, parcela e outra categoria", () => {
		const other = spend({ categoryId: "mercado", amountCents: 90000, date: "2026-11-07" });
		const noCat = spend({ categoryId: null, amountCents: 90000, date: "2026-11-07" });
		const installment = spend({ amountCents: 90000, date: "2026-11-07", installmentGroupId: "g" });
		expect(detectUnusualSpending({ recent: [other, noCat, installment], history, minCents: 100 })).toEqual(
			[],
		);
	});
	it("as recentes não entram na própria mediana", () => {
		const recent = history.slice(0, 1);
		expect(detectUnusualSpending({ recent, history, minCents: 100 })).toEqual([]);
	});
});

describe("detectDuplicateCharges", () => {
	const a = spend({ id: "a", merchant: "Spotify AB", amountCents: 3190, date: "2026-11-05" });
	const b = spend({ id: "b", merchant: "SPOTIFY AB", amountCents: 3190, date: "2026-11-07" });
	it("acha o mesmo estabelecimento e valor dentro da janela, e aponta a repetida", () => {
		expect(detectDuplicateCharges({ transactions: [b, a], windowDays: 3, since: "2026-11-01" })).toEqual([
			{
				transactionId: "b",
				firstTransactionId: "a",
				merchant: "SPOTIFY AB",
				amountCents: 3190,
				firstDate: "2026-11-05",
				date: "2026-11-07",
				daysApart: 2,
			},
		]);
	});
	it("fora da janela, valor diferente ou parcela do mesmo parcelamento não contam", () => {
		expect(detectDuplicateCharges({ transactions: [a, b], windowDays: 1, since: "2026-11-01" })).toEqual([]);
		const other = { ...b, amountCents: 3191 };
		expect(detectDuplicateCharges({ transactions: [a, other], windowDays: 3, since: "2026-11-01" })).toEqual(
			[],
		);
		const p1 = { ...a, installmentGroupId: "g" };
		const p2 = { ...b, installmentGroupId: "g" };
		expect(detectDuplicateCharges({ transactions: [p1, p2], windowDays: 3, since: "2026-11-01" })).toEqual(
			[],
		);
	});
	it("só é novidade a repetida de `since` em diante", () => {
		expect(detectDuplicateCharges({ transactions: [a, b], windowDays: 3, since: "2026-11-08" })).toEqual([]);
		expect(detectDuplicateCharges({ transactions: [a, b], windowDays: 3, since: "2026-11-07" })).toHaveLength(
			1,
		);
	});
	it("mesmo dia conta (janela 0) e a janela precisa ser inteira", () => {
		const same = { ...b, date: "2026-11-05" };
		expect(
			detectDuplicateCharges({ transactions: [a, same], windowDays: 0, since: "2026-11-01" }),
		).toHaveLength(1);
		expect(() =>
			detectDuplicateCharges({ transactions: [], windowDays: 1.5, since: "2026-11-01" }),
		).toThrow();
	});
});

describe("detectBudgetThresholds", () => {
	const budgets = [
		{ scope: "delivery", limitCents: 50000, spentCents: 45000 },
		{ scope: "mercado", limitCents: 100000, spentCents: 120000 },
		{ scope: "lazer", limitCents: 30000, spentCents: 10000 },
		{ scope: "total", limitCents: 400000, spentCents: 320000 },
	];
	it("separa o que passou do percentual do que estourou, e ignora o resto", () => {
		const hits = detectBudgetThresholds({ budgets, thresholdPercent: 80 });
		expect(hits.map((h) => [h.scope, h.level, h.remainingCents])).toEqual([
			["delivery", "alert", 5000],
			["mercado", "over", -20000],
		]);
		// 320000 de 400000 é exatamente 80%: não passou.
		expect(hits.find((h) => h.scope === "total")).toBeUndefined();
	});
	it("percentual mais baixo pega mais", () => {
		expect(detectBudgetThresholds({ budgets, thresholdPercent: 50 }).map((h) => h.scope)).toEqual([
			"delivery",
			"mercado",
			"total",
		]);
	});
});
