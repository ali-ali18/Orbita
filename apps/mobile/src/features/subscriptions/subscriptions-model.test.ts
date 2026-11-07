import { describe, expect, it } from "vitest";
import {
	buildRequest,
	chargeCaption,
	countLabel,
	formFromRecurrence,
	initialForm,
	isAffectedBySubscription,
	monthlyTotalCents,
	monthStatus,
	nextSummary,
	parseDay,
	parseSourceKey,
	type RecurrenceLike,
	sortSubscriptions,
	subscriptionsCategoryId,
	validateForm,
	wasPosted,
} from "./subscriptions-model.ts";

const rec = (over: Partial<RecurrenceLike> & { id: string }): RecurrenceLike => ({
	kind: "expense",
	name: "Netflix",
	amountCents: 4490,
	dayOfMonth: 18,
	startDate: "2026-01-01",
	endDate: null,
	categoryId: null,
	accountId: null,
	cardId: "c1",
	archivedAt: null,
	...over,
});

const TODAY = "2026-11-06";
const MONTH = "2026-11";

describe("lista e total", () => {
	const list = [
		rec({ id: "a", name: "Google One", amountCents: 9699, dayOfMonth: 12 }),
		rec({ id: "b", name: "Vivo", amountCents: 6151, dayOfMonth: 4 }),
		rec({
			id: "salario",
			name: "Salário",
			kind: "income",
			amountCents: 500000,
			dayOfMonth: 5,
			cardId: null,
			accountId: "x",
		}),
		rec({ id: "old", name: "Antiga", archivedAt: "2026-05-01T00:00:00.000Z" }),
		rec({ id: "fim", name: "Acabou", endDate: "2026-06-30" }),
	];

	it("ordena pela próxima cobrança e ignora receita e arquivada", () => {
		expect(sortSubscriptions(list, TODAY).map((r) => r.id)).toEqual(["a", "b", "fim"]);
	});

	it("soma só o que cai no mês, em centavos inteiros", () => {
		expect(monthlyTotalCents(list, MONTH)).toBe(9699 + 6151);
	});

	it("mês sem nada soma zero", () => {
		expect(monthlyTotalCents([], MONTH)).toBe(0);
	});

	it("resume a próxima cobrança", () => {
		expect(nextSummary(list, TODAY)).toBe("Próxima: Google One, dia 12 · em 6 dias");
		expect(nextSummary([], TODAY)).toBeNull();
	});

	it("conta com singular", () => {
		expect(countLabel(1)).toBe("1 assinatura");
		expect(countLabel(4)).toBe("4 assinaturas");
	});
});

describe("situação do mês", () => {
	const r = rec({ id: "a", name: "Netflix", dayOfMonth: 4 });
	const tx = { kind: "expense", description: " netflix ", accountId: null, cardId: "c1" };

	it("reconhece o lançamento do mês pelo nome, tipo e cartão", () => {
		expect(wasPosted(r, [tx])).toBe(true);
		expect(wasPosted(r, [{ ...tx, cardId: "c2" }])).toBe(false);
		expect(wasPosted(r, [{ ...tx, kind: "income" }])).toBe(false);
	});

	it("lançada, pendente ou fora do mês", () => {
		expect(monthStatus(r, MONTH, [tx])).toBe("posted");
		expect(monthStatus(r, MONTH, [])).toBe("pending");
		expect(monthStatus(rec({ id: "z", startDate: "2027-01-01" }), MONTH, [])).toBe("none");
	});

	it("legenda diz lançada, pendente (data passada) ou em quantos dias", () => {
		expect(chargeCaption(r, "posted", TODAY, MONTH)).toBe("Todo dia 4 · lançada");
		expect(chargeCaption(r, "pending", TODAY, MONTH)).toBe("Todo dia 4 · pendente");
		const future = rec({ id: "f", dayOfMonth: 12 });
		expect(chargeCaption(future, "pending", TODAY, MONTH)).toBe("Todo dia 12 · em 6 dias");
		expect(chargeCaption(future, "pending", "2026-11-12", MONTH)).toBe("Todo dia 12 · hoje");
		expect(chargeCaption(rec({ id: "e", endDate: "2026-06-30" }), "none", TODAY, MONTH)).toBe(
			"Todo dia 18 · encerrada",
		);
	});
});

describe("formulário", () => {
	it("começa com o dia de hoje e valor zero", () => {
		expect(initialForm(TODAY)).toEqual({ name: "", amountCents: 0, dayOfMonth: 6, sourceKey: null });
	});

	it("volta do registro para o formulário", () => {
		expect(formFromRecurrence(rec({ id: "a" })).sourceKey).toBe("card:c1");
		expect(formFromRecurrence(rec({ id: "a", cardId: null, accountId: "ac" })).sourceKey).toBe("account:ac");
	});

	it("entende a chave de origem", () => {
		expect(parseSourceKey("card:c1")).toEqual({ type: "card", id: "c1" });
		expect(parseSourceKey("x:1")).toBeNull();
		expect(parseSourceKey("card:")).toBeNull();
		expect(parseSourceKey(null)).toBeNull();
	});

	it("valida os limites com mensagem em pt-BR", () => {
		const ok = { name: "Netflix", amountCents: 4490, dayOfMonth: 18, sourceKey: "card:c1" };
		const src = { type: "card", id: "c1" } as const;
		expect(validateForm(ok, src)).toBeNull();
		expect(validateForm({ ...ok, name: "  " }, src)).toBe("Informe o nome da assinatura.");
		expect(validateForm({ ...ok, amountCents: 0 }, src)).toBe("Informe o valor da cobrança.");
		expect(validateForm({ ...ok, amountCents: 2_147_483_648 }, src)).toBe("O valor passa do limite aceito.");
		expect(validateForm({ ...ok, dayOfMonth: 32 }, src)).toBe("O dia vai de 1 a 31.");
		expect(validateForm({ ...ok, dayOfMonth: 0 }, src)).toBe("O dia vai de 1 a 31.");
		expect(validateForm(ok, null)).toBe("Escolha a conta ou o cartão da cobrança.");
	});

	it("lê o dia digitado", () => {
		expect(parseDay("")).toBeNull();
		expect(parseDay("0")).toBeNull();
		expect(parseDay("32")).toBeNull();
		expect(parseDay("1a8")).toBe(18);
		expect(parseDay("31")).toBe(31);
	});
});

describe("buildRequest", () => {
	const form = { name: " Netflix ", amountCents: 4490, dayOfMonth: 18, sourceKey: "card:c1" };

	it("cria despesa no cartão, começando hoje, com a categoria Assinaturas", () => {
		const built = buildRequest({
			form,
			source: { type: "card", id: "c1" },
			today: TODAY,
			categoryId: "cat1",
			editingId: null,
		});
		expect(built).toEqual({
			ok: true,
			request: {
				type: "create",
				body: {
					kind: "expense",
					name: "Netflix",
					amountCents: 4490,
					dayOfMonth: 18,
					startDate: TODAY,
					categoryId: "cat1",
					cardId: "c1",
					accountId: null,
				},
			},
		});
	});

	it("conta no lugar do cartão e sem categoria", () => {
		const built = buildRequest({
			form,
			source: { type: "account", id: "a1" },
			today: TODAY,
			categoryId: null,
			editingId: null,
		});
		expect(built.ok && built.request.type === "create" && built.request.body).toMatchObject({
			accountId: "a1",
			cardId: null,
		});
		expect(built.ok && built.request.type === "create" && "categoryId" in built.request.body).toBe(false);
	});

	it("editar troca só nome, valor, dia e origem (início e categoria ficam)", () => {
		const built = buildRequest({
			form,
			source: { type: "account", id: "a1" },
			today: TODAY,
			categoryId: "cat1",
			editingId: "r9",
		});
		expect(built).toEqual({
			ok: true,
			request: {
				type: "update",
				id: "r9",
				body: { name: "Netflix", amountCents: 4490, dayOfMonth: 18, accountId: "a1", cardId: null },
			},
		});
	});

	it("devolve a mensagem de validação", () => {
		const built = buildRequest({
			form: { ...form, amountCents: 0 },
			source: { type: "card", id: "c1" },
			today: TODAY,
			categoryId: null,
			editingId: null,
		});
		expect(built).toEqual({ ok: false, message: "Informe o valor da cobrança." });
	});
});

describe("categoria e invalidação", () => {
	it("acha Assinaturas sem acento nem caixa, ignorando arquivadas", () => {
		const cats = [
			{ id: "1", name: "Mercado", archivedAt: null },
			{ id: "2", name: "ASSINATURAS", archivedAt: "2026-01-01T00:00:00.000Z" },
			{ id: "3", name: "Assinaturas", archivedAt: null },
		];
		expect(subscriptionsCategoryId(cats)).toBe("3");
		expect(subscriptionsCategoryId(cats.slice(0, 2))).toBeNull();
	});

	it("recarrega o resumo do Início e só do servidor atual", () => {
		expect(isAffectedBySubscription(["https://a", "summary", "2026-11"], "https://a")).toBe(true);
		expect(isAffectedBySubscription(["https://b", "summary", "2026-11"], "https://a")).toBe(false);
		expect(isAffectedBySubscription(["https://a", "categories"], "https://a")).toBe(false);
	});
});
