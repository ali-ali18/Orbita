import { describe, expect, it } from "vitest";
import { chatRequestBody } from "./chat-api.ts";
import {
	appliedView,
	fullSelection,
	proposalConfirmBody,
	resolveSetupSelection,
	type SetupProposal,
	setupSelectionSchema,
} from "./setup-api.ts";

const proposal: SetupProposal = {
	source: "ai",
	subscriptions: [
		{
			key: "rec:netflix",
			name: "Netflix",
			categoryId: "c-ass",
			merchant: "NETFLIX.COM",
			amountCents: 4490,
			amountText: "R$ 44,90",
			dayOfMonth: 10,
			startDate: "2026-11-01",
			occurrences: 3,
			lastDate: "2026-10-10",
			accountId: null,
			cardId: "card-1",
		},
	],
	categoryRules: [
		{
			key: "cat:unip mensalidade",
			pattern: "unip mensalidade",
			merchant: "UNIP*MENSALIDADE 0423",
			categoryId: "c-edu",
			count: 4,
			totalCents: 200000,
			totalText: "R$ 2.000,00",
			applyToExisting: true,
		},
	],
	income: {
		key: "inc:acme",
		name: "Salário",
		payer: "ACME LTDA",
		amountCents: 500000,
		amountText: "R$ 5.000,00",
		payday: 5,
		accountId: "acc-1",
	},
	plan: { reservePercent: 10 },
};

describe("seleção da proposta de configuração", () => {
	it("tudo marcado vira a seleção completa", () => {
		const selection = fullSelection(proposal);
		expect(selection).toEqual({
			subscriptions: [{ key: "rec:netflix", name: "Netflix", categoryId: "c-ass" }],
			categoryRules: [{ key: "cat:unip mensalidade", categoryId: "c-edu", applyToExisting: true }],
			income: { name: "Salário" },
			applyPlan: true,
		});
	});

	it("item sem categoria obriga a escolher ou desmarcar", () => {
		const bare = {
			...proposal,
			subscriptions: [{ ...(proposal.subscriptions[0] as object), categoryId: null }],
		};
		expect(fullSelection(bare as SetupProposal)).toEqual({
			error: 'Escolha a categoria de "Netflix" ou desmarque.',
		});
	});

	it("nome e categoria vêm do dono; valor, dia e data, sempre da proposta", () => {
		const selection = setupSelectionSchema.parse({
			subscriptions: [{ key: "rec:netflix", name: "Netflix (família)", categoryId: "c-lazer" }],
			categoryRules: [],
			income: null,
			applyPlan: false,
		});
		const resolved = resolveSetupSelection(proposal, selection);
		expect(resolved).toEqual({
			ok: true,
			input: {
				subscriptions: [
					{
						key: "rec:netflix",
						name: "Netflix (família)",
						categoryId: "c-lazer",
						amountCents: 4490,
						dayOfMonth: 10,
						startDate: "2026-11-01",
						accountId: null,
						cardId: "card-1",
					},
				],
				categoryRules: [],
				income: null,
				plan: null,
			},
		});
	});

	it("o pedido não consegue incluir valor, dia nem item que a proposta não tem", () => {
		expect(
			setupSelectionSchema.safeParse({
				subscriptions: [{ key: "rec:netflix", name: "N", categoryId: "c", amountCents: 1 }],
				categoryRules: [],
				income: null,
				applyPlan: false,
			}).success,
		).toBe(false);
		const stranger = setupSelectionSchema.parse({
			subscriptions: [{ key: "rec:outra", name: "Outra", categoryId: "c" }],
			categoryRules: [],
			income: null,
			applyPlan: false,
		});
		expect(resolveSetupSelection(proposal, stranger)).toMatchObject({ ok: false });
		const dup = setupSelectionSchema.parse({
			subscriptions: [
				{ key: "rec:netflix", name: "A", categoryId: "c" },
				{ key: "rec:netflix", name: "B", categoryId: "c" },
			],
			categoryRules: [],
			income: null,
			applyPlan: false,
		});
		expect(resolveSetupSelection(proposal, dup)).toMatchObject({ ok: false });
	});

	it("renda e plano só existem se a proposta os tem; nada marcado não confirma", () => {
		const noExtras = { ...proposal, income: null, plan: null };
		const wantsIncome = setupSelectionSchema.parse({
			subscriptions: [],
			categoryRules: [],
			income: { name: "Salário" },
			applyPlan: false,
		});
		expect(resolveSetupSelection(noExtras, wantsIncome)).toMatchObject({ ok: false });
		const wantsPlan = setupSelectionSchema.parse({
			subscriptions: [],
			categoryRules: [],
			income: null,
			applyPlan: true,
		});
		expect(resolveSetupSelection(noExtras, wantsPlan)).toMatchObject({ ok: false });
		const empty = setupSelectionSchema.parse({
			subscriptions: [],
			categoryRules: [],
			income: null,
			applyPlan: false,
		});
		expect(resolveSetupSelection(proposal, empty)).toEqual({
			ok: false,
			message: "Marque pelo menos um item para confirmar.",
		});
	});

	it("depois de confirmar o card mostra só o aplicado, com os nomes finais", () => {
		const view = appliedView(proposal, {
			subscriptions: [{ key: "rec:netflix", name: "Netflix família", categoryId: "c-lazer" }],
			categoryRules: [],
			income: { name: "Salário ACME" },
			applyPlan: false,
		});
		expect(view.subscriptions.map((s) => [s.name, s.categoryId, s.amountCents])).toEqual([
			["Netflix família", "c-lazer", 4490],
		]);
		expect(view.categoryRules).toEqual([]);
		expect(view.income?.name).toBe("Salário ACME");
		expect(view.plan).toBeNull();
	});

	it("o corpo do confirmar é estrito", () => {
		expect(proposalConfirmBody.safeParse({}).success).toBe(true);
		expect(proposalConfirmBody.safeParse({ extra: 1 }).success).toBe(false);
	});
});

describe("pedido de chat com a tarefa de configuração", () => {
	it("a tarefa fixa não leva mensagem digitada; sem tarefa a mensagem é obrigatória", () => {
		expect(chatRequestBody.safeParse({ intent: "setup" }).success).toBe(true);
		expect(chatRequestBody.safeParse({ intent: "setup", message: "oi" }).success).toBe(false);
		expect(chatRequestBody.safeParse({}).success).toBe(false);
		expect(chatRequestBody.safeParse({ message: "oi" }).success).toBe(true);
		expect(chatRequestBody.safeParse({ intent: "outra" }).success).toBe(false);
	});

	it("a tarefa abre sempre uma conversa nova com a Órbita", () => {
		expect(chatRequestBody.safeParse({ intent: "setup", conversationId: "c1" }).success).toBe(false);
		expect(chatRequestBody.safeParse({ intent: "setup", agentId: "a1" }).success).toBe(false);
	});
});
