import { describe, expect, it } from "vitest";
import {
	activityCaption,
	dayLabel,
	dayTotal,
	emptyMessage,
	flattenPages,
	groupByDay,
	matchesFilter,
	matchesQuery,
	weekdayOf,
} from "./activity-model.ts";

const TODAY = "2026-11-07";

describe("weekdayOf e dayLabel", () => {
	it("acha o dia da semana pela data de calendário", () => {
		expect(weekdayOf("2026-11-07")).toBe(6); // sábado
		expect(weekdayOf("2026-11-03")).toBe(2); // terça
	});

	it("Hoje e Ontem; o resto com dia da semana", () => {
		expect(dayLabel("2026-11-07", TODAY)).toBe("Hoje");
		expect(dayLabel("2026-11-06", TODAY)).toBe("Ontem");
		expect(dayLabel("2026-11-03", TODAY)).toBe("Terça-feira, 3 de nov");
	});

	it("Ontem vale na virada de mês e ano", () => {
		expect(dayLabel("2026-10-31", "2026-11-01")).toBe("Ontem");
		expect(dayLabel("2025-12-31", "2026-01-01")).toBe("Ontem");
	});

	it("outro ano leva o ano", () => {
		expect(dayLabel("2025-12-24", TODAY)).toBe("Quarta-feira, 24 de dez de 2025");
	});
});

describe("dayTotal", () => {
	it("soma saídas e entradas com sinal", () => {
		expect(
			dayTotal([
				{ kind: "expense", amountCents: 4690 },
				{ kind: "expense", amountCents: 12000 },
				{ kind: "income", amountCents: 6 },
			]),
		).toBe(-16684);
	});

	it("ignora transferência e pagamento de fatura; estorno entra somando", () => {
		expect(
			dayTotal([
				{ kind: "expense", amountCents: 1000 },
				{ kind: "transfer", amountCents: 50000 },
				{ kind: "card_payment", amountCents: 71942 },
				{ kind: "refund", amountCents: 300 },
			]),
		).toBe(-700);
	});

	it("dia vazio é zero", () => {
		expect(dayTotal([])).toBe(0);
	});
});

describe("groupByDay", () => {
	const t = (id: string, date: string, kind: "expense" | "income" = "expense", amountCents = 100) => ({
		id,
		date,
		kind,
		amountCents,
	});

	it("agrupa por dia, mais novo primeiro, e calcula o total", () => {
		const groups = groupByDay(
			[t("a", "2026-11-07", "expense", 500), t("b", "2026-11-07", "income", 200), t("c", "2026-11-06")],
			TODAY,
		);
		expect(groups.map((g) => [g.label, g.items.map((i) => i.id), g.total])).toEqual([
			["Hoje", ["a", "b"], -300],
			["Ontem", ["c"], -100],
		]);
	});

	it("data repetida fora de ordem cai no mesmo grupo e os dias saem em ordem decrescente", () => {
		const groups = groupByDay([t("a", "2026-11-05"), t("b", "2026-11-06"), t("c", "2026-11-05")], TODAY);
		expect(groups.map((g) => g.date)).toEqual(["2026-11-06", "2026-11-05"]);
		expect(groups[1]?.items.map((i) => i.id)).toEqual(["a", "c"]);
	});

	it("lista vazia não gera grupo", () => {
		expect(groupByDay([], TODAY)).toEqual([]);
	});
});

describe("flattenPages", () => {
	it("junta páginas sem repetir id", () => {
		const pages = [
			{ transactions: [{ id: "a" }, { id: "b" }] },
			{ transactions: [{ id: "b" }, { id: "c" }] },
		];
		expect(flattenPages(pages).map((x) => x.id)).toEqual(["a", "b", "c"]);
	});
});

describe("filtros", () => {
	it("Tudo, Saídas, Entradas e Cartão", () => {
		const expenseCard = { kind: "expense", cardId: "c1" } as const;
		const expenseAccount = { kind: "expense", cardId: null } as const;
		const income = { kind: "income", cardId: null } as const;
		const refund = { kind: "refund", cardId: "c1" } as const;
		const transfer = { kind: "transfer", cardId: null } as const;
		expect(matchesFilter(transfer, "all")).toBe(true);
		expect(matchesFilter(expenseCard, "out")).toBe(true);
		expect(matchesFilter(income, "out")).toBe(false);
		expect(matchesFilter(transfer, "out")).toBe(false);
		expect(matchesFilter(income, "in")).toBe(true);
		expect(matchesFilter(refund, "in")).toBe(true);
		expect(matchesFilter(expenseAccount, "in")).toBe(false);
		expect(matchesFilter(expenseCard, "card")).toBe(true);
		expect(matchesFilter(expenseAccount, "card")).toBe(false);
	});
});

describe("matchesQuery", () => {
	const ifood = { description: "iFood Pedido", amountCents: 4690 };

	it("sem texto, tudo passa", () => {
		expect(matchesQuery(ifood, undefined, "  ")).toBe(true);
	});

	it("nome sem acento e sem caixa", () => {
		expect(matchesQuery({ description: "Pão de Açúcar", amountCents: 100 }, undefined, "pao de acucar")).toBe(
			true,
		);
		expect(matchesQuery(ifood, undefined, "IFOOD")).toBe(true);
		expect(matchesQuery(ifood, undefined, "uber")).toBe(false);
	});

	it("categoria", () => {
		expect(matchesQuery(ifood, "Delivery", "deliv")).toBe(true);
		expect(matchesQuery(ifood, undefined, "deliv")).toBe(false);
	});

	it("valor pelos dígitos", () => {
		expect(matchesQuery(ifood, undefined, "46,90")).toBe(true);
		expect(matchesQuery(ifood, undefined, "R$ 46")).toBe(true);
		expect(matchesQuery(ifood, undefined, "99")).toBe(false);
	});
});

describe("activityCaption", () => {
	const sources = {
		accounts: new Map([["a1", { name: "Inter" }]]),
		cards: new Map([["c1", { name: "Nubank", last4: "4821" }]]),
	};
	const base = { cardId: null, accountId: null, installmentNumber: null, installmentCount: null };

	it("categoria · cartão com final · parcela", () => {
		expect(
			activityCaption({ ...base, cardId: "c1", installmentNumber: 2, installmentCount: 3 }, "Lazer", sources),
		).toBe("Lazer · Nubank ••••4821 · 2/3");
	});

	it("conta sem categoria", () => {
		expect(activityCaption({ ...base, accountId: "a1" }, undefined, sources)).toBe("Inter");
	});

	it("fonte desconhecida some sem quebrar", () => {
		expect(activityCaption({ ...base, accountId: "x" }, "Mercado", sources)).toBe("Mercado");
	});
});

describe("emptyMessage", () => {
	it("explica o motivo conforme busca, filtro e se há mais páginas", () => {
		expect(emptyMessage("all", "", false)).toBe("Nenhum lançamento por aqui ainda.");
		expect(emptyMessage("out", "", false)).toBe("Nenhum lançamento desse tipo.");
		expect(emptyMessage("out", "", true)).toContain("Role a lista");
		expect(emptyMessage("all", "uber", false)).toBe("Nenhum lançamento encontrado.");
		expect(emptyMessage("all", "uber", true)).toContain("Role a lista");
		expect(emptyMessage("all", "", false, true)).toBe("Nenhum lançamento com esses filtros.");
		expect(emptyMessage("all", "", false, false)).toBe("Nenhum lançamento por aqui ainda.");
	});
});
