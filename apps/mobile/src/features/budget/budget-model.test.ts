import { describe, expect, it } from "vitest";
import {
	budgetRows,
	buildSetRequest,
	categoryLimitsSum,
	changedByRequests,
	isAffectedByBudget,
	isAffectedByPreferences,
	limitsExceedTotal,
	replacedCount,
	suggestionCaption,
	suggestionRequests,
	TOTAL_SCOPE,
	totalLimit,
	validateLimit,
	withUnassignedSpend,
} from "./budget-model.ts";

const cat = (id: string, name: string, chartSlot: number | null, archivedAt: string | null = null) => ({
	id,
	name,
	chartSlot,
	archivedAt,
});

const categories = [
	cat("lazer", "Lazer", 4),
	cat("mercado", "Mercado", 0),
	cat("saude", "Saúde", null),
	cat("delivery", "Delivery", 1),
	cat("velha", "Velha", 2, "2026-01-01T00:00:00.000Z"),
];

describe("totalLimit", () => {
	it("acha o limite total ou null", () => {
		expect(totalLimit([{ scope: TOTAL_SCOPE, limitCents: 300000 }])).toBe(300000);
		expect(totalLimit([{ scope: "mercado", limitCents: 90000 }])).toBeNull();
		expect(totalLimit([])).toBeNull();
	});
});

describe("budgetRows", () => {
	const budgets = [
		{ scope: "mercado", limitCents: 90000 },
		{ scope: "delivery", limitCents: 50000 },
		{ scope: "velha", limitCents: 10000 },
	];
	const spent = { mercado: 61200, delivery: 59900, saude: 1000 };

	it("limites primeiro, na ordem das cores; depois as sem limite; arquivada fora", () => {
		expect(budgetRows(categories, budgets, spent).map((r) => r.id)).toEqual([
			"mercado",
			"delivery",
			"lazer",
			"saude",
		]);
	});

	it("calcula barra e estouro só com inteiros", () => {
		const [mercado, delivery, lazer] = budgetRows(categories, budgets, spent);
		expect(mercado).toMatchObject({ limitCents: 90000, spentCents: 61200, fillPercent: 68, over: false });
		expect(delivery).toMatchObject({ fillPercent: 100, over: true });
		expect(lazer).toMatchObject({ limitCents: null, spentCents: 0, fillPercent: 0, over: false });
	});

	it("limite zero com gasto enche a barra; gasto negativo (estorno) conta zero", () => {
		const rows = budgetRows(
			[cat("a", "A", 0), cat("b", "B", 1)],
			[
				{ scope: "a", limitCents: 0 },
				{ scope: "b", limitCents: 1000 },
			],
			{ a: 500, b: -300 },
		);
		expect(rows[0]).toMatchObject({ fillPercent: 100, over: true });
		expect(rows[1]).toMatchObject({ spentCents: 0, fillPercent: 0 });
	});

	it("o gasto sem categoria entra em Outros, para fechar com o total do mês", () => {
		const rows = budgetRows([...categories, cat("out", "Outros", null)], budgets, spent);
		const aligned = withUnassignedSpend(rows, 130000);
		expect(aligned.find((row) => row.name === "Outros")?.spentCents).toBe(7900);
		expect(aligned.reduce((sum, row) => sum + row.spentCents, 0)).toBe(130000);
		expect(withUnassignedSpend(rows, 122100)).toBe(rows);
	});

	it("soma os limites e compara com o total", () => {
		const rows = budgetRows(categories, budgets, spent);
		expect(categoryLimitsSum(rows)).toBe(140000);
		expect(limitsExceedTotal(rows, 100000)).toBe(true);
		expect(limitsExceedTotal(rows, 140000)).toBe(false);
		expect(limitsExceedTotal(rows, null)).toBe(false);
	});
});

describe("requisição", () => {
	it("valida o limite", () => {
		expect(validateLimit(0)).toBe("Informe um valor maior que zero.");
		expect(validateLimit(1.5)).toBe("Informe um valor maior que zero.");
		expect(validateLimit(2_147_483_648)).toBe("O valor passa do limite aceito.");
		expect(validateLimit(300000)).toBeNull();
	});

	it("monta o PUT em centavos inteiros", () => {
		expect(buildSetRequest(TOTAL_SCOPE, 300000)).toEqual({
			ok: true,
			request: { scope: "total", limitCents: 300000 },
		});
		expect(buildSetRequest("mercado", 0)).toEqual({ ok: false, message: "Informe um valor maior que zero." });
	});

	it("recarrega resumo e limites só do servidor atual", () => {
		expect(isAffectedByBudget(["https://a", "summary", "2026-11"], "https://a")).toBe(true);
		expect(isAffectedByBudget(["https://a", "budgets"], "https://a")).toBe(true);
		expect(isAffectedByBudget(["https://a", "categories"], "https://a")).toBe(false);
		expect(isAffectedByBudget(["https://b", "summary"], "https://a")).toBe(false);
	});
});

describe("sugestão da Órbita", () => {
	const suggestion = {
		months: 3,
		monthsUsed: 3,
		totalCents: 130000,
		byCategory: { mercado: 90000, lazer: 40000, velha: 5000 },
	};

	it("grava o total e um limite por categoria ativa com sugestão", () => {
		expect(suggestionRequests(suggestion, categories)).toEqual([
			{ scope: TOTAL_SCOPE, limitCents: 130000 },
			{ scope: "lazer", limitCents: 40000 },
			{ scope: "mercado", limitCents: 90000 },
		]);
	});

	it("sem sugestão não há pedido", () => {
		expect(
			suggestionRequests({ months: 3, monthsUsed: 0, totalCents: 0, byCategory: {} }, categories),
		).toEqual([]);
	});

	it("só muda o que é diferente do limite atual, e conta quantos limites seriam trocados", () => {
		const reqs = suggestionRequests(suggestion, categories);
		const budgets = [
			{ scope: TOTAL_SCOPE, limitCents: 130000 },
			{ scope: "mercado", limitCents: 50000 },
		];
		expect(changedByRequests(reqs, budgets)).toEqual([
			{ scope: "lazer", limitCents: 40000 },
			{ scope: "mercado", limitCents: 90000 },
		]);
		expect(replacedCount(changedByRequests(reqs, budgets), budgets)).toBe(1);
		expect(
			changedByRequests(reqs, [
				...budgets,
				{ scope: "lazer", limitCents: 40000 },
				{ scope: "mercado", limitCents: 90000 },
			]),
		).toEqual([]);
	});

	it("legenda conforme quantos meses entraram", () => {
		expect(suggestionCaption({ months: 3, monthsUsed: 3 }, "R$ 2.800")).toBe(
			"Sugestão da Órbita: R$ 2.800, pela mediana dos últimos 3 meses",
		);
		expect(suggestionCaption({ months: 3, monthsUsed: 2 }, "R$ 2.800")).toBe(
			"Sugestão da Órbita: R$ 2.800, pela mediana dos 2 últimos meses com gastos",
		);
		expect(suggestionCaption({ months: 3, monthsUsed: 1 }, "R$ 2.800")).toContain("único mês fechado");
	});

	it("linha avisa só quando passou do percentual sem estourar", () => {
		const alerts = new Set(["mercado", "lazer"]);
		const rows = budgetRows(
			categories,
			[
				{ scope: "mercado", limitCents: 1000 },
				{ scope: "lazer", limitCents: 1000 },
			],
			{ mercado: 900, lazer: 1500 },
			alerts,
		);
		expect(Object.fromEntries(rows.map((r) => [r.id, [r.warn, r.over]]))).toMatchObject({
			mercado: [true, false],
			lazer: [false, true],
			saude: [false, false],
		});
	});

	it("salvar preferências e limites recarrega o resumo", () => {
		expect(isAffectedByPreferences(["u", "summary", "2026-11"], "u")).toBe(true);
		expect(isAffectedByPreferences(["u", "preferences"], "u")).toBe(true);
		expect(isAffectedByPreferences(["u", "accounts"], "u")).toBe(false);
	});
});
