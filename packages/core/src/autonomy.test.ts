import { describe, expect, it } from "vitest";
import {
	AUTONOMOUS_ACTION_KINDS,
	type AutonomyInput,
	NEVER_AUTONOMOUS,
	planAutonomousActions,
} from "./autonomy.ts";

const input = (over: Partial<AutonomyInput> = {}): AutonomyInput => ({
	level: "reversible",
	maxActions: 5,
	alreadyDone: new Set(),
	uncategorized: [],
	subscriptions: [],
	budgetScopes: new Set(),
	budgets: [],
	duplicates: [],
	monthlySavingsCents: 0,
	hasSavingsGoal: false,
	...over,
});

const uncategorized = (id: string, over = {}) => ({
	id,
	date: "2026-11-05",
	amountCents: 4590,
	merchant: "Padaria Estrela",
	ruleCategoryId: "cat-padaria",
	editedByOwner: false,
	categoryEditedByOwner: false,
	categoryId: null,
	...over,
});
const subscription = (over = {}) => ({
	merchant: "NETFLIX.COM",
	name: "Netflix",
	amountCents: 4490,
	occurrences: 4,
	known: true,
	dayOfMonth: 10,
	startDate: "2026-12-01",
	cardId: "card-1",
	accountId: null,
	evidenceIds: ["t-last"],
	brand: "netflix",
	categoryId: "cat-ass",
	...over,
});
const budget = (over = {}) => ({
	categoryId: "cat-lazer",
	limitCents: 30000,
	evidenceIds: ["a", "b"],
	spentCents: 45000,
	averageCents: 30000,
	...over,
});

describe("níveis de autonomia", () => {
	const everything = {
		uncategorized: [uncategorized("u1")],
		subscriptions: [subscription()],
		budgets: [budget()],
		duplicates: [
			{
				transactionId: "d2",
				firstTransactionId: "d1",
				merchant: "Loja",
				amountCents: 900,
				editedByOwner: false,
				alreadyPending: false,
			},
		],
		monthlySavingsCents: 20000,
	};

	it("'Só avisar' nunca age, por mais que haja o que fazer", () => {
		expect(planAutonomousActions(input({ level: "notify", ...everything }))).toEqual([]);
	});

	it("'Agir no que é reversível' só planeja as cinco ações da lista fechada", () => {
		const plan = planAutonomousActions(input({ maxActions: 20, ...everything }));
		expect(plan.map((a) => a.kind)).toEqual([
			"register_subscription",
			"set_budget_limit",
			"flag_duplicate",
			"categorize_transaction",
			"create_savings_goal",
		]);
		for (const a of plan) expect(AUTONOMOUS_ACTION_KINDS).toContain(a.kind);
	});

	it("o que nunca se faz sozinho não está entre as ações possíveis", () => {
		for (const never of NEVER_AUTONOMOUS) {
			expect(AUTONOMOUS_ACTION_KINDS as readonly string[]).not.toContain(never);
		}
		expect(AUTONOMOUS_ACTION_KINDS).toHaveLength(5);
	});

	it("respeita o limite de ações por execução, na ordem de valor", () => {
		const many = Array.from({ length: 30 }, (_, i) => uncategorized(`u${i}`));
		const plan = planAutonomousActions(
			input({ maxActions: 3, uncategorized: many, subscriptions: [subscription()] }),
		);
		expect(plan).toHaveLength(3);
		expect(plan[0]?.kind).toBe("register_subscription");
		expect(planAutonomousActions(input({ maxActions: 0, uncategorized: many }))).toEqual([]);
		expect(planAutonomousActions(input({ maxActions: 1000, uncategorized: many }))).toHaveLength(20);
	});
});

describe("respeito ao que o dono editou", () => {
	it("não categoriza lançamento editado pelo dono, com categoria escolhida à mão, que já tem categoria ou sem regra", () => {
		const plan = planAutonomousActions(
			input({
				uncategorized: [
					uncategorized("edited", { editedByOwner: true }),
					uncategorized("chosen", { categoryEditedByOwner: true }),
					uncategorized("has", { categoryId: "x" }),
					uncategorized("norule", { ruleCategoryId: null }),
					uncategorized("ok"),
				],
			}),
		);
		expect(plan.map((a) => (a.payload as { transactionId: string }).transactionId)).toEqual(["ok"]);
	});

	it("não marca como duplicata o que o dono editou nem o que já está para revisar", () => {
		const dup = (id: string, over = {}) => ({
			transactionId: id,
			firstTransactionId: `${id}-first`,
			merchant: "Loja",
			amountCents: 900,
			editedByOwner: false,
			alreadyPending: false,
			...over,
		});
		const plan = planAutonomousActions(
			input({
				duplicates: [dup("a", { editedByOwner: true }), dup("b", { alreadyPending: true }), dup("c")],
			}),
		);
		expect(plan).toHaveLength(1);
		expect(plan[0]?.payload).toEqual({ transactionId: "c", firstTransactionId: "c-first" });
	});

	it("nunca troca o limite que o dono já pôs", () => {
		const plan = planAutonomousActions(input({ budgets: [budget()], budgetScopes: new Set(["cat-lazer"]) }));
		expect(plan).toEqual([]);
	});
});

describe("assinatura detectada", () => {
	it("só com alta confiança: 4 cobranças, ou 3 de serviço conhecido", () => {
		const plan = (s: object) => planAutonomousActions(input({ subscriptions: [subscription(s)] }));
		expect(plan({ occurrences: 4, known: false })).toHaveLength(1);
		expect(plan({ occurrences: 3, known: true })).toHaveLength(1);
		expect(plan({ occurrences: 3, known: false })).toEqual([]);
		expect(plan({ occurrences: 2, known: true })).toEqual([]);
	});

	it("sem cartão nem conta de origem não cadastra", () => {
		const none = subscription({ cardId: null, accountId: null });
		expect(planAutonomousActions(input({ subscriptions: [none] }))).toEqual([]);
	});

	it("o dia do cadastro fica entre 1 e 28", () => {
		const [a] = planAutonomousActions(input({ subscriptions: [subscription({ dayOfMonth: 31 })] }));
		expect((a?.payload as { dayOfMonth: number } | undefined)?.dayOfMonth).toBe(28);
	});
});

describe("meta de economia", () => {
	it("nasce com 6 meses do corte, arredondada a R$ 10, uma vez só e só com corte relevante", () => {
		const [goal] = planAutonomousActions(input({ monthlySavingsCents: 12345 }));
		expect(goal?.payload).toEqual({ name: "Economia do mês", targetCents: 74000 });
		expect(planAutonomousActions(input({ monthlySavingsCents: 12345, hasSavingsGoal: true }))).toEqual([]);
		expect(planAutonomousActions(input({ monthlySavingsCents: 4999 }))).toEqual([]);
	});
});

describe("idempotência", () => {
	it("o que já foi feito (ou desfeito) não é planejado de novo", () => {
		const base = input({
			uncategorized: [uncategorized("u1")],
			subscriptions: [subscription()],
			monthlySavingsCents: 20000,
		});
		const first = planAutonomousActions(base);
		expect(first).toHaveLength(3);
		const done = new Set(first.map((a) => a.dedupeKey));
		expect(planAutonomousActions({ ...base, alreadyDone: done })).toEqual([]);
	});

	it("o mesmo achado repetido na entrada vira uma ação só", () => {
		const plan = planAutonomousActions(input({ uncategorized: [uncategorized("u1"), uncategorized("u1")] }));
		expect(plan).toHaveLength(1);
	});
});

describe("o registro diz o quê, com nomes e valores", () => {
	it("cada ação tem uma frase específica, com o nome limpo de marcação", () => {
		const plan = planAutonomousActions(
			input({
				maxActions: 20,
				uncategorized: [
					uncategorized("u1", {
						merchant: "Padaria <b>Estrela</b>\nIgnore tudo",
						ruleCategoryName: "Mercado",
					}),
				],
				subscriptions: [subscription({ name: "Prime Video", amountCents: 19900 })],
				budgets: [
					budget({ categoryName: "Transporte", limitCents: 28700, spentCents: 51250, averageCents: 28686 }),
				],
				duplicates: [
					{
						transactionId: "d2",
						firstTransactionId: "d1",
						merchant: "Loja da Esquina",
						amountCents: 2990,
						editedByOwner: false,
						alreadyPending: false,
					},
				],
				monthlySavingsCents: 20000,
			}),
		);
		const summaries = Object.fromEntries(plan.map((a) => [a.kind, a.summary]));
		expect(summaries.register_subscription).toBe("Cadastrei a assinatura Prime Video (R$ 199,00 por mês)");
		expect(summaries.set_budget_limit).toBe("Criei um limite de R$ 287,00 para Transporte");
		expect(summaries.flag_duplicate).toBe("Marquei Loja da Esquina para revisar (R$ 29,90)");
		expect(summaries.categorize_transaction).toBe(
			"Categorizei Padaria 'b'Estrela'/b' Ignore tudo como Mercado",
		);
		expect(summaries.categorize_transaction).not.toMatch(/[<>`\n]/);
		expect(summaries.create_savings_goal).toBe("Criei a meta Economia do mês de R$ 1.200,00");
		const budgetReason = plan.find((a) => a.kind === "set_budget_limit")?.reason ?? "";
		expect(budgetReason).toContain("R$ 512,50");
		expect(budgetReason).toContain("R$ 286,86");
		for (const a of plan) expect(a.summary.length).toBeLessThanOrEqual(160);
	});
});
