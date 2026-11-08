import type { SetupProposal } from "@orbita/shared";
import { describe, expect, it } from "vitest";
import {
	buildSelection,
	confirmLabel,
	initialDraft,
	isAffectedBySetup,
	occurrencesLine,
	ruleLine,
	selectedCount,
	setCategory,
	setName,
	subscriptionLine,
	toggleItem,
	toggleRetro,
} from "./setup-card-model.ts";

const setup: SetupProposal = {
	source: "template",
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
		{
			key: "rec:unip",
			name: "Unip Mensalidade",
			categoryId: null,
			merchant: "UNIP*MENSALIDADE 0423",
			amountCents: 48000,
			amountText: "R$ 480,00",
			dayOfMonth: 8,
			startDate: "2026-11-01",
			occurrences: 4,
			lastDate: "2026-10-08",
			accountId: "acc-1",
			cardId: null,
		},
	],
	categoryRules: [
		{
			key: "cat:padaria",
			pattern: "padaria",
			merchant: "PADARIA SAO JOSE",
			categoryId: null,
			count: 3,
			totalCents: 7000,
			totalText: "R$ 70,00",
			applyToExisting: true,
		},
	],
	income: {
		key: "inc:acme",
		name: "Salário",
		payer: "ACME",
		amountCents: 500000,
		amountText: "R$ 5.000,00",
		payday: 5,
		accountId: "acc-1",
	},
	plan: { reservePercent: 10 },
};

describe("rascunho do card", () => {
	it("vem marcado o que tem categoria; o que não tem espera a escolha", () => {
		const d = initialDraft(setup);
		expect(d.subs["rec:netflix"]).toEqual({ checked: true, name: "Netflix", categoryId: "c-ass" });
		expect(d.subs["rec:unip"]).toEqual({ checked: false, name: "Unip Mensalidade", categoryId: null });
		expect(d.rules["cat:padaria"]?.checked).toBe(false);
		expect(d.income).toEqual({ checked: true, name: "Salário" });
		expect(d.plan).toEqual({ checked: true });
		expect(selectedCount(d)).toBe(3);
		expect(confirmLabel(3)).toBe("Confirmar selecionados (3)");
	});

	it("sem categoria não dá para marcar; escolher a categoria já marca", () => {
		let d = initialDraft(setup);
		d = toggleItem(d, { section: "sub", key: "rec:unip" });
		expect(d.subs["rec:unip"]?.checked).toBe(false);
		d = setCategory(d, { section: "sub", key: "rec:unip" }, "c-edu");
		expect(d.subs["rec:unip"]).toMatchObject({ checked: true, categoryId: "c-edu" });
		// Trocar a categoria de um item que o dono desmarcou não o marca de novo.
		d = toggleItem(d, { section: "sub", key: "rec:unip" });
		d = setCategory(d, { section: "sub", key: "rec:unip" }, "c-lazer");
		expect(d.subs["rec:unip"]?.checked).toBe(false);
	});

	it("marca e desmarca renda e plano, edita nomes e alterna o retroativo da regra", () => {
		let d = initialDraft(setup);
		d = toggleItem(d, { section: "income" });
		d = toggleItem(d, { section: "plan" });
		expect(selectedCount(d)).toBe(1);
		d = setName(d, { section: "income" }, "Salário ACME");
		expect(d.income?.name).toBe("Salário ACME");
		d = toggleRetro(d, "cat:padaria");
		expect(d.rules["cat:padaria"]?.applyToExisting).toBe(false);
	});
});

describe("seleção enviada ao servidor", () => {
	it("leva só nome, categoria e o marcado: nenhum valor, dia ou data", () => {
		let d = initialDraft(setup);
		d = setName(d, { section: "sub", key: "rec:netflix" }, "  Netflix (família) ");
		d = setCategory(d, { section: "sub", key: "rec:unip" }, "c-edu");
		d = setName(d, { section: "sub", key: "rec:unip" }, "Faculdade (Unip)");
		d = setCategory(d, { section: "rule", key: "cat:padaria" }, "c-mer");
		const built = buildSelection(setup, d);
		expect(built).toEqual({
			ok: true,
			selection: {
				subscriptions: [
					{ key: "rec:netflix", name: "Netflix (família)", categoryId: "c-ass" },
					{ key: "rec:unip", name: "Faculdade (Unip)", categoryId: "c-edu" },
				],
				categoryRules: [{ key: "cat:padaria", categoryId: "c-mer", applyToExisting: true }],
				income: { name: "Salário" },
				applyPlan: true,
			},
		});
		expect(JSON.stringify(built)).not.toMatch(/amountCents|dayOfMonth|startDate|payday/);
	});

	it("pede nome, recusa nome grande demais e exige ao menos um item marcado", () => {
		let d = initialDraft(setup);
		d = setName(d, { section: "sub", key: "rec:netflix" }, "   ");
		expect(buildSelection(setup, d)).toEqual({ ok: false, message: "Dê um nome a cada assinatura marcada." });
		d = setName(d, { section: "sub", key: "rec:netflix" }, "x".repeat(61));
		expect(buildSelection(setup, d)).toMatchObject({ ok: false });
		let none = initialDraft(setup);
		none = toggleItem(none, { section: "sub", key: "rec:netflix" });
		none = toggleItem(none, { section: "income" });
		none = toggleItem(none, { section: "plan" });
		expect(buildSelection(setup, none)).toEqual({ ok: false, message: "Marque pelo menos um item." });
		expect(selectedCount(none)).toBe(0);
	});
});

describe("textos do card", () => {
	it("juntam o que o servidor mandou", () => {
		expect(subscriptionLine({ amountText: "R$ 44,90", dayOfMonth: 10 })).toBe("R$ 44,90 · todo dia 10");
		expect(ruleLine({ count: 1, totalText: "R$ 10,00" })).toBe("1 lançamento · R$ 10,00");
		expect(ruleLine({ count: 3, totalText: "R$ 70,00" })).toBe("3 lançamentos · R$ 70,00");
		expect(occurrencesLine({ occurrences: 3, lastDate: "2026-10-08" })).toBe(
			"3 cobranças, a última em 08/10",
		);
	});

	it("confirmar ou desfazer atualiza tudo do servidor, menos o chat e o custo da IA", () => {
		const url = "https://x";
		expect(isAffectedBySetup([url, "recurrences"], url)).toBe(true);
		expect(isAffectedBySetup([url, "income"], url)).toBe(true);
		expect(isAffectedBySetup([url, "chat", "conversations"], url)).toBe(false);
		expect(isAffectedBySetup([url, "settings", "ai"], url)).toBe(false);
		expect(isAffectedBySetup(["https://outro", "income"], url)).toBe(false);
	});
});
