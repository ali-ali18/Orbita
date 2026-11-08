import { describe, expect, it } from "vitest";
import { incomePlan, type PlanCommitment } from "./income-plan.ts";

const base = { month: "2026-11", goals: [], history: [] as Record<string, number>[] };
const sub = (id: string, cents: number, categoryId: string | null = "assinaturas"): PlanCommitment => ({
	id,
	name: id,
	categoryId,
	amountCents: cents,
	source: "recurrence",
});
const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

describe("incomePlan", () => {
	it("distribui a renda: compromissos, dia a dia, metas, reserva e sobra", () => {
		const plan = incomePlan({
			...base,
			incomeCents: 500000,
			commitments: [sub("netflix", 5000), { ...sub("parcela", 30000, "lazer"), source: "installment" }],
			history: [
				{ mercado: 80000, assinaturas: 5000 },
				{ mercado: 90000, assinaturas: 5000 },
				{ mercado: 85000, assinaturas: 5000 },
			],
			goals: [{ id: "g", name: "Viagem", monthlyNeededCents: 50000 }],
		});
		expect(plan.feasible).toBe(true);
		expect(plan.buckets).toEqual({
			commitmentsCents: 35000,
			dailyCents: 85000,
			goalsCents: 50000,
			reserveCents: 50000,
			leftCents: 280000,
		});
		expect(plan.budget.totalCents).toBe(120000);
		expect(plan.budget.byCategory).toEqual({ mercado: 85000, lazer: 30000, assinaturas: 5000 });
		expect(plan.warnings).toEqual([]);
		expect(plan.cut).toBeNull();
	});

	it("o total do orçamento é sempre a soma dos limites das categorias", () => {
		const plan = incomePlan({
			...base,
			incomeCents: 230000,
			commitments: [sub("x", 3333)],
			history: [{ a: 100001, b: 99999, assinaturas: 3333 }],
		});
		expect(plan.budget.totalCents).toBe(sum(plan.budget.byCategory));
	});

	it("renda R$ 2.300 e mediana R$ 2.775: corta o dia a dia para caber (renda − reserva)", () => {
		const plan = incomePlan({
			...base,
			incomeCents: 230000,
			commitments: [],
			history: [{ mercado: 150000, lazer: 127500 }],
		});
		expect(plan.cut).toEqual({ wantedCents: 277500, capCents: 207000 });
		expect(plan.budget.totalCents).toBe(207000);
		expect(sum(plan.budget.byCategory)).toBe(207000);
		expect(plan.buckets.reserveCents).toBe(23000);
		expect(plan.buckets.leftCents).toBe(0);
		const w = plan.warnings.find((x) => x.code === "scaled_to_fit");
		expect(w?.message).toContain("2.775,00");
		expect(w?.message).toContain("2.070,00");
		expect(w?.amountCents).toBe(70500);
	});

	it("desconta as metas do teto e nunca passa da renda", () => {
		const plan = incomePlan({
			...base,
			incomeCents: 230000,
			commitments: [],
			history: [{ a: 277500 }],
			goals: [{ id: "g", name: "Reserva", monthlyNeededCents: 20000 }],
		});
		expect(plan.budget.totalCents).toBe(187000);
		expect(plan.budget.totalCents + plan.buckets.goalsCents + plan.buckets.reserveCents).toBeLessThanOrEqual(
			230000,
		);
	});

	it("compromissos nunca são reduzidos no corte", () => {
		const plan = incomePlan({
			...base,
			incomeCents: 230000,
			commitments: [sub("aluguel", 100000, "moradia")],
			history: [{ moradia: 100000, mercado: 200000, lazer: 100000 }],
		});
		expect(plan.categories.find((c) => c.categoryId === "moradia")).toMatchObject({
			commitmentsCents: 100000,
			totalCents: 100000,
		});
		expect(plan.budget.totalCents).toBe(207000);
		expect(plan.budget.byCategory.moradia).toBe(100000);
	});

	it("compromissos acima da renda: aviso claro e nenhum plano falso", () => {
		const plan = incomePlan({
			...base,
			incomeCents: 230000,
			commitments: [sub("aluguel", 200000, "moradia"), sub("cartao", 60000, "outros")],
			history: [{ mercado: 100000 }],
		});
		expect(plan.feasible).toBe(false);
		expect(plan.budget).toEqual({ totalCents: 0, byCategory: {} });
		expect(plan.warnings[0]).toMatchObject({ code: "commitments_exceed_income", amountCents: 30000 });
		expect(plan.warnings[0]?.message).toContain("passam da renda");
	});

	it("compromissos cabem na renda mas não na reserva e metas: dia a dia zera e avisa", () => {
		const plan = incomePlan({
			...base,
			incomeCents: 230000,
			commitments: [sub("aluguel", 220000, "moradia")],
			history: [{ mercado: 50000, moradia: 220000 }],
		});
		expect(plan.feasible).toBe(true);
		expect(plan.buckets.dailyCents).toBe(0);
		expect(plan.budget.totalCents).toBe(220000);
		expect(plan.warnings.map((w) => w.code)).toContain("plan_exceeds_income");
	});

	it("sem renda cadastrada avisa e não sugere", () => {
		const plan = incomePlan({ ...base, incomeCents: 0, commitments: [sub("x", 100)] });
		expect(plan.feasible).toBe(false);
		expect(plan.warnings.map((w) => w.code)).toEqual(["no_income", "no_history"]);
	});

	it("categoria fixa: o limite vale como compromisso quando passa das recorrências", () => {
		const plan = incomePlan({
			...base,
			incomeCents: 500000,
			commitments: [sub("luz", 10000, "moradia")],
			fixedBudgets: { moradia: 120000, saude: 30000 },
			history: [{ moradia: 120000, mercado: 40000 }],
		});
		expect(plan.categories.find((c) => c.categoryId === "moradia")?.commitmentsCents).toBe(120000);
		expect(plan.categories.find((c) => c.categoryId === "saude")?.totalCents).toBe(30000);
		expect(plan.commitments.filter((c) => c.source === "fixed_budget")).toHaveLength(2);
	});

	it("investimentos ficam fora dos limites e do dia a dia", () => {
		const plan = incomePlan({
			...base,
			incomeCents: 230000,
			commitments: [],
			excludeCategoryIds: ["invest"],
			history: [{ mercado: 100000, invest: 73800 }],
		});
		expect(plan.budget.byCategory).toEqual({ mercado: 100000 });
	});

	it("compromisso sem categoria cai em Outros e a reserva é configurável", () => {
		const plan = incomePlan({
			...base,
			incomeCents: 100000,
			commitments: [sub("avulso", 5000, null)],
			reservePercent: 25,
		});
		expect(plan.budget.byCategory).toEqual({ outros: 5000 });
		expect(plan.buckets.reserveCents).toBe(25000);
		expect(() => incomePlan({ ...base, incomeCents: 1, commitments: [], reservePercent: 101 })).toThrow(
			RangeError,
		);
	});

	it("é determinístico", () => {
		const input = {
			...base,
			incomeCents: 230000,
			commitments: [sub("a", 777)],
			history: [{ x: 100001, y: 100003, z: 99999 }],
		};
		expect(incomePlan(input)).toEqual(incomePlan(input));
	});
});
