import { describe, expect, it } from "vitest";
import type { MonthReportView } from "../../lib/api.ts";
import {
	budgetLine,
	categoryBars,
	changeCaption,
	headline,
	initialMonth,
	monthChoices,
	narrative,
	percentLabel,
	reportSubtitle,
} from "./report-model.ts";

const categories = [
	{ id: "c-mercado", name: "Mercado", slug: "mercado", chartSlot: null },
	{ id: "c-delivery", name: "Delivery", slug: "delivery", chartSlot: null },
	{ id: "c-lazer", name: "Lazer", slug: "lazer", chartSlot: 2 },
];

const row = (categoryId: string, spentCents: number, previousCents: number, percent: number | null) => ({
	categoryId,
	spentCents,
	previousCents,
	deltaCents: spentCents - previousCents,
	percent,
	sharePercent: 0,
});

const report = (over: Partial<MonthReportView> = {}): MonthReportView => ({
	month: "2026-10",
	closedOn: "2026-11-01",
	totals: { incomeCents: 420000, spentCents: 388760, balanceCents: 31240, refundCreditCents: 0 },
	vsPrevious: null,
	vsAverage: null,
	topCategories: [
		row("c-mercado", 98000, 111364, -12),
		row("c-delivery", 52000, 38806, 34),
		row("c-lazer", 24000, 40678, -41),
	],
	biggestExpenses: [],
	subscriptions: { totalCents: 0, count: 0, change: null },
	budget: { rows: [], withinCount: 0, overCount: 0, adherencePercent: null },
	invoices: { cards: [], totalCents: 0 },
	...over,
});

describe("rótulos", () => {
	it("percentual com sinal de menos de verdade", () => {
		expect(percentLabel(34)).toBe("+34%");
		expect(percentLabel(-12)).toBe("−12%");
		expect(percentLabel(0)).toBe("0%");
		expect(percentLabel(null)).toBeNull();
	});

	it("legenda de Entrou e Saiu", () => {
		expect(changeCaption({ referenceCents: 100, deltaCents: 0, percent: 0 }, "2026-09")).toBe(
			"igual a setembro",
		);
		expect(changeCaption({ referenceCents: 100, deltaCents: -8, percent: -8 }, "2026-09")).toBe("8% a menos");
		expect(changeCaption({ referenceCents: 100, deltaCents: 12, percent: 12 }, "2026-09")).toBe("12% a mais");
		expect(changeCaption({ referenceCents: 0, deltaCents: 500, percent: null }, "2026-09")).toBe(
			"a mais que setembro",
		);
		expect(changeCaption(undefined, undefined)).toBe("sem mês anterior para comparar");
	});

	it("a frase do topo", () => {
		expect(headline(31240)).toEqual({ lead: "fechou com", amount: 31240, tail: "de sobra" });
		expect(headline(-5000)).toEqual({ lead: "fechou com", amount: 5000, tail: "a mais do que entrou" });
		expect(headline(0).amount).toBe(0);
	});

	it("subtítulo do mês fechado e do mês aberto", () => {
		expect(reportSubtitle({ month: "2026-10", closedOn: "2026-11-01" }, "2026-11")).toBe(
			"Relatório de outubro · 1 de nov",
		);
		expect(reportSubtitle({ month: "2026-11", closedOn: "2026-12-01" }, "2026-11")).toBe(
			"Relatório de novembro · parcial",
		);
	});

	it("linha do orçamento", () => {
		expect(budgetLine({ rows: [], withinCount: 0, overCount: 0, adherencePercent: null })).toBeNull();
		expect(budgetLine({ rows: [], withinCount: 3, overCount: 1, adherencePercent: 75 })).toBe(
			"3 de 4 limites respeitados",
		);
		expect(budgetLine({ rows: [], withinCount: 1, overCount: 0, adherencePercent: 100 })).toBe(
			"1 de 1 limite respeitado",
		);
	});
});

describe("meses", () => {
	it("abre no último mês fechado com dado", () => {
		expect(initialMonth(["2026-11", "2026-10", "2026-08"], "2026-11")).toBe("2026-10");
		expect(initialMonth(["2026-11"], "2026-11")).toBe("2026-11");
		expect(initialMonth([], "2026-11")).toBe("2026-10");
		expect(initialMonth([], "2027-01")).toBe("2026-12");
	});

	it("lista do mais antigo ao mais novo e sempre traz o mês de hoje", () => {
		expect(monthChoices(["2026-10", "2026-08"], "2026-11")).toEqual([
			{ month: "2026-08", status: "fechado" },
			{ month: "2026-10", status: "fechado" },
			{ month: "2026-11", status: "em andamento" },
		]);
	});
});

describe("barras por categoria", () => {
	it("mesma régua para as duas barras; cor da categoria", () => {
		const bars = categoryBars(report().topCategories, categories);
		expect(bars.map((b) => b.name)).toEqual(["Mercado", "Delivery", "Lazer"]);
		// A maior de todas (mercado de setembro, 111364) vale 1.
		expect(bars[0]?.previousRatio).toBe(1);
		expect(bars[0]?.currentRatio).toBeCloseTo(98000 / 111364, 6);
		expect(bars.map((b) => b.percent)).toEqual(["−12%", "+34%", "−41%"]);
		expect(bars[2]?.color).not.toBe(bars[0]?.color);
	});

	it("lista vazia não divide por zero e categoria desconhecida vira Outros", () => {
		expect(categoryBars([], categories)).toEqual([]);
		const [only] = categoryBars([row("sumiu", 0, 0, null)], categories);
		expect(only).toMatchObject({ name: "Outros", currentRatio: 0, percent: null });
	});
});

describe("narrative (modelo fixo, sem IA)", () => {
	it("usa só os números do relatório", () => {
		const text = narrative(report(), categories);
		expect(text).toBe("Delivery subiu 34%. Em compensação, Lazer caiu 41%. Sobraram R$ 312,40.");
	});

	it("inclui assinaturas quando subiram", () => {
		const text = narrative(
			report({
				subscriptions: {
					totalCents: 26200,
					count: 3,
					change: { referenceCents: 21653, deltaCents: 4547, percent: 21 },
				},
			}),
			categories,
		);
		expect(text).toContain("As assinaturas subiram 21%.");
	});

	it("mês no vermelho e sem comparação", () => {
		const text = narrative(
			report({
				topCategories: [],
				totals: { incomeCents: 1000, spentCents: 3500, balanceCents: -2500, refundCreditCents: 0 },
			}),
			categories,
		);
		expect(text).toBe("Ainda não há mês anterior para comparar. Saiu R$ 25,00 a mais do que entrou.");
	});
});
