import type { IncomeSourceDto, PlanDto } from "@orbita/shared";
import { describe, expect, it } from "vitest";
import {
	aboveIncomeWarning,
	appliedMessage,
	buildIncomeRequest,
	canApplyPlan,
	formFromSource,
	hasUndo,
	initialIncomeForm,
	isAffectedByIncome,
	paydayLine,
	planBarParts,
	planRows,
	planWarningText,
	replaceMessage,
	sourceCaption,
	validateIncomeForm,
} from "./income-model.ts";

const source = (over: Partial<IncomeSourceDto> = {}): IncomeSourceDto => ({
	id: "i1",
	name: "Salário",
	amountCents: 230000,
	payday: 5,
	accountId: null,
	recurring: true,
	month: null,
	archivedAt: null,
	createdAt: "2026-11-01T00:00:00.000Z",
	updatedAt: "2026-11-01T00:00:00.000Z",
	...over,
});

const plan: Pick<PlanDto, "buckets" | "reservePercent" | "goals" | "commitments" | "feasible" | "budget"> = {
	buckets: { commitmentsCents: 5000, dailyCents: 202000, goalsCents: 0, reserveCents: 23000, leftCents: 0 },
	reservePercent: 10,
	goals: [],
	commitments: [{ id: "r", name: "Netflix", categoryId: null, amountCents: 5000, source: "recurrence" }],
	feasible: true,
	budget: { totalCents: 207000, byCategory: { a: 207000 } },
};

describe("formulário de renda", () => {
	it("a primeira renda nasce como salário, recorrente; as outras, como avulsas do mês", () => {
		expect(initialIncomeForm("2026-11", true)).toMatchObject({ name: "Salário", recurring: true });
		expect(initialIncomeForm("2026-11", false)).toMatchObject({
			name: "",
			recurring: false,
			month: "2026-11",
		});
	});

	it("valida nome, valor e dia", () => {
		const ok = { ...initialIncomeForm("2026-11", true), amountCents: 230000 };
		expect(validateIncomeForm(ok)).toBeNull();
		expect(validateIncomeForm({ ...ok, name: "  " })).toBe("Dê um nome para a renda.");
		expect(validateIncomeForm({ ...ok, amountCents: 0 })).toBe("Informe quanto você recebe.");
		expect(validateIncomeForm({ ...ok, payday: 32 })).toBe("O dia do pagamento vai de 1 a 31.");
		expect(validateIncomeForm({ ...ok, payday: 0 })).toBe("O dia do pagamento vai de 1 a 31.");
	});

	it("criar: recorrente não manda mês; avulsa manda; conta só se escolhida", () => {
		const base = { ...initialIncomeForm("2026-11", true), amountCents: 230000 };
		expect(buildIncomeRequest({ form: base, editingId: null })).toEqual({
			ok: true,
			request: {
				type: "create",
				body: { name: "Salário", amountCents: 230000, payday: 5, recurring: true },
			},
		});
		const freela = { ...base, name: "Freela", recurring: false, accountId: "a1" };
		expect(buildIncomeRequest({ form: freela, editingId: null })).toMatchObject({
			request: { body: { recurring: false, month: "2026-11", accountId: "a1" } },
		});
	});

	it("editar manda tudo, limpando conta e mês quando não valem", () => {
		const form = formFromSource(source({ accountId: "a1" }), "2026-11");
		const built = buildIncomeRequest({ form: { ...form, accountId: null }, editingId: "i1" });
		expect(built).toEqual({
			ok: true,
			request: {
				type: "update",
				id: "i1",
				body: {
					name: "Salário",
					amountCents: 230000,
					payday: 5,
					recurring: true,
					accountId: null,
					month: null,
				},
			},
		});
		expect(buildIncomeRequest({ form: { ...form, amountCents: 0 }, editingId: "i1" })).toMatchObject({
			ok: false,
		});
	});
});

describe("textos", () => {
	it("legenda da renda", () => {
		expect(sourceCaption(source())).toBe("Todo mês · dia 5");
		expect(sourceCaption(source({ recurring: false, month: "2026-11", payday: 20 }))).toBe(
			"Só em novembro de 2026 · dia 20",
		);
	});

	it("quando o dinheiro cai", () => {
		expect(paydayLine("Salário", 0)).toBe("Salário cai hoje");
		expect(paydayLine("Salário", 1)).toBe("Salário cai amanhã");
		expect(paydayLine("Salário", 20)).toBe("Salário cai em 20 dias");
	});

	it("aviso de limite acima da renda, sem bloquear", () => {
		expect(aboveIncomeWarning(250000, 230000)).toBe("Esse limite está acima da sua renda de R$ 2.300,00.");
		expect(aboveIncomeWarning(230000, 230000)).toBeNull();
		expect(aboveIncomeWarning(null, 230000)).toBeNull();
		expect(aboveIncomeWarning(250000, 0)).toBeNull();
		expect(aboveIncomeWarning(250000, 230000, true)).toBe("Esse limite está acima da sua renda de ••••.");
	});

	it("mensagens de aplicar", () => {
		expect(replaceMessage(1)).toContain("1 limite que você definiu será trocado");
		expect(replaceMessage(4)).toContain("4 limites que você definiu serão trocados");
		expect(appliedMessage(207000)).toBe("Orçamento atualizado: R$ 2.070,00 no mês.");
		expect(appliedMessage(207000, true)).toBe("Orçamento atualizado: •••• no mês.");
	});
});

describe("plano", () => {
	it("linhas na ordem fixa, com o que o servidor mandou", () => {
		const rows = planRows(plan);
		expect(rows.map((r) => r.key)).toEqual(["commitments", "daily", "goals", "reserve", "left"]);
		expect(rows.map((r) => r.cents)).toEqual([5000, 202000, 0, 23000, 0]);
		expect(rows[0]?.caption).toBe("1 item");
		expect(rows[3]?.caption).toBe("10% da renda");
		expect(rows[2]?.caption).toBe("Nenhuma meta com prazo");
	});

	it("sobra negativa avisa na legenda e fica fora da barra", () => {
		const rows = planRows({ ...plan, buckets: { ...plan.buckets, leftCents: -3000 } });
		expect(rows[4]?.caption).toBe("Falta para fechar o mês");
		expect(planBarParts(rows).map((p) => p.key)).toEqual(["commitments", "daily", "reserve"]);
	});

	it("aviso do plano sem valores quando o olho está fechado", () => {
		const w = { code: "scaled_to_fit" as const, message: "Seu histórico é R$ 2.775,00 ...", amountCents: 1 };
		expect(planWarningText(w, false)).toBe(w.message);
		expect(planWarningText(w, true)).toBe("Ajustei os limites para caber na sua renda.");
		const other = {
			code: "no_income" as const,
			message: "Cadastre sua renda para organizar o mês.",
			amountCents: 0,
		};
		expect(planWarningText(other, true)).toBe(other.message);
	});

	it("só aplica plano viável com limite", () => {
		expect(canApplyPlan(plan)).toBe(true);
		expect(canApplyPlan({ ...plan, feasible: false })).toBe(false);
		expect(canApplyPlan({ ...plan, budget: { totalCents: 0, byCategory: {} } })).toBe(false);
	});

	it("o Desfazer só existe se algo mudou", () => {
		expect(hasUndo([])).toBe(false);
		expect(hasUndo([{ scope: "total", limitCents: null }])).toBe(true);
	});

	it("renda, plano, orçamento e resumo recarregam juntos", () => {
		for (const key of ["income", "plan", "budgets", "summary"]) {
			expect(isAffectedByIncome(["u", key], "u")).toBe(true);
		}
		expect(isAffectedByIncome(["u", "goals"], "u")).toBe(false);
		expect(isAffectedByIncome(["outro", "income"], "u")).toBe(false);
	});
});
