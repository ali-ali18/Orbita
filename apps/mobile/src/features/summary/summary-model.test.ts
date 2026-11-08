import { categoryColor, chartSeries } from "@orbita/tokens";
import { describe, expect, it } from "vitest";
import {
	budgetAlertNotice,
	cardTileInvoices,
	categoryShares,
	currentInvoiceMonth,
	FREE_KEY,
	heroBarParts,
	heroModel,
	installmentsOverview,
	invoiceCaption,
	RESERVED_KEY,
} from "./summary-model.ts";
import { amountSignMode, initialOf, signedAmount, transactionCaption } from "./transaction-model.ts";

const categories = [
	{ id: "mer", name: "Mercado", chartSlot: 0 },
	{ id: "del", name: "Delivery", chartSlot: 1 },
	{ id: "laz", name: "Lazer", chartSlot: 4 },
	{ id: "mor", name: "Moradia", slug: "moradia", chartSlot: null },
	{ id: "out", name: "Outros", slug: "outros", chartSlot: null },
];

describe("categoryShares", () => {
	it("cada categoria fica com o próprio gasto; o que não tem categoria entra em Outros", () => {
		const shares = categoryShares(
			{ laz: 500, mor: 100000, mer: 3000, out: 250, del: 2000, ghost: 50 },
			categories,
		);
		expect(shares.map((s) => [s.name, s.cents])).toEqual([
			["Mercado", 3000],
			["Delivery", 2000],
			["Lazer", 500],
			["Moradia", 100000],
			["Outros", 300],
		]);
		expect(shares.map((s) => s.color)).toEqual([
			chartSeries[0],
			chartSeries[1],
			chartSeries[4],
			categoryColor({ slug: "moradia" }),
			categoryColor({ slug: "outros" }),
		]);
	});
	it("ignora categoria sem gasto e devolve vazio sem dados", () => {
		expect(categoryShares({ mer: 0 }, categories)).toEqual([]);
		expect(categoryShares({}, categories)).toEqual([]);
	});
});

describe("parcelamentos", () => {
	it("conta só os que ainda têm parcela e soma a do mês", () => {
		const groups = [
			{
				remainingCount: 2,
				installments: [
					{ invoiceMonth: "2026-10", amountCents: 10000 },
					{ invoiceMonth: "2026-11", amountCents: 10000 },
					{ invoiceMonth: "2026-12", amountCents: 10000 },
				],
			},
			{ remainingCount: 0, installments: [{ invoiceMonth: "2026-11", amountCents: 999 }] },
		];
		expect(installmentsOverview(groups, "2026-11")).toEqual({ activeCount: 1, monthlyCents: 10000 });
		expect(installmentsOverview([], "2026-11")).toEqual({ activeCount: 0, monthlyCents: 0 });
	});
});

describe("fatura", () => {
	const card = { closingDay: 10, dueDay: 20, closingRule: "closing-day-next" } as const;
	it("a fatura aberta é a do mês do vencimento", () => {
		expect(currentInvoiceMonth(card, "2026-11-06")).toBe("2026-11");
		expect(currentInvoiceMonth(card, "2026-11-10")).toBe("2026-12");
	});
	it("legenda por situação", () => {
		const base = { closingDate: "2026-11-10", dueDate: "2026-11-20" };
		expect(invoiceCaption({ ...base, status: "open" }, "2026-11-07")).toBe("Fecha em 3 dias");
		expect(invoiceCaption({ ...base, status: "open" }, "2026-11-09")).toBe("Fecha em 1 dia");
		expect(invoiceCaption({ ...base, status: "closed" }, "2026-11-15")).toBe("Vence em 5 dias");
		expect(invoiceCaption({ ...base, status: "overdue" }, "2026-11-22")).toBe("Venceu há 2 dias");
	});
});

describe("lançamentos", () => {
	const sources = {
		accounts: new Map([["a1", { name: "Inter" }]]),
		cards: new Map([["c1", { name: "Nubank", last4: "0695" }]]),
	};
	const base = {
		kind: "expense",
		amountCents: 4590,
		date: "2026-11-05",
		accountId: null,
		cardId: "c1",
		installmentNumber: 2,
		installmentCount: 3,
		status: "confirmed",
	} as const;
	it("legenda com cartão, parcela e pendência", () => {
		expect(transactionCaption(base, "2026-11-06", sources)).toBe("Ontem · Nubank ••••0695 · 2/3");
		expect(
			transactionCaption(
				{
					...base,
					cardId: null,
					accountId: "a1",
					installmentNumber: null,
					installmentCount: null,
					status: "pending",
				},
				"2026-11-06",
				sources,
			),
		).toBe("Ontem · Inter · Para revisar");
	});
	it("sinais", () => {
		expect(signedAmount({ kind: "expense", amountCents: 100 })).toBe(-100);
		expect(signedAmount({ kind: "refund", amountCents: 100 })).toBe(100);
		expect(amountSignMode("card_payment")).toBe("never");
		expect(amountSignMode("income")).toBe("always");
		expect(initialOf("  inter")).toBe("I");
		expect(initialOf("")).toBe("·");
	});
});

describe("heroModel", () => {
	it("dentro do orçamento e com sobra", () => {
		const h = heroModel({
			spentCents: 209120,
			limitCents: 300000,
			availableCents: 80890,
			reservedCents: 9990,
		});
		expect(h).toMatchObject({ overBudget: false, reserveExceeds: false, freeCents: 80890, percent: 70 });
	});
	it("contas a vencer passam do que sobra, mas gasto <= limite: reserva, não estouro", () => {
		const h = heroModel({
			spentCents: 209120,
			limitCents: 300000,
			availableCents: -4110,
			reservedCents: 95000,
		});
		expect(h).toMatchObject({ overBudget: false, reserveExceeds: true, freeCents: 0, percent: 70 });
	});
	it("gasto exatamente no limite não é estouro", () => {
		expect(
			heroModel({ spentCents: 300000, limitCents: 300000, availableCents: 0, reservedCents: 0 }).overBudget,
		).toBe(false);
	});
	it("gasto maior que o limite é estouro (e não 'reserva')", () => {
		const h = heroModel({
			spentCents: 310000,
			limitCents: 300000,
			availableCents: -20000,
			reservedCents: 10000,
		});
		expect(h).toMatchObject({ overBudget: true, reserveExceeds: false });
	});
	it("limite zero: percentual 100 só se houve gasto", () => {
		expect(heroModel({ spentCents: 0, limitCents: 0, availableCents: 0, reservedCents: 0 }).percent).toBe(0);
		expect(heroModel({ spentCents: 5, limitCents: 0, availableCents: -5, reservedCents: 0 }).percent).toBe(
			100,
		);
	});
});

describe("heroBarParts", () => {
	const shares = categoryShares({ mer: 60000, del: 40000 }, categories);
	it("três partes: gasto, contas a vencer listradas e livre", () => {
		const hero = heroModel({
			spentCents: 100000,
			limitCents: 300000,
			availableCents: 150000,
			reservedCents: 50000,
		});
		const parts = heroBarParts(shares, hero);
		expect(parts.map((p) => p.key)).toEqual(["slot-0", "slot-1", RESERVED_KEY, FREE_KEY]);
		expect(parts.map((p) => p.weight)).toEqual([60000, 40000, 50000, 150000]);
		expect(parts.find((p) => p.key === RESERVED_KEY)?.striped).toBe(true);
		expect(parts.reduce((s, p) => s + p.weight, 0)).toBe(300000);
	});
	it("reserva maior que a sobra: ocupa só a sobra e não há livre", () => {
		const hero = heroModel({
			spentCents: 100000,
			limitCents: 300000,
			availableCents: -50000,
			reservedCents: 250000,
		});
		const parts = heroBarParts(shares, hero);
		expect(parts.map((p) => p.key)).toEqual(["slot-0", "slot-1", RESERVED_KEY]);
		expect(parts.reduce((s, p) => s + p.weight, 0)).toBe(300000);
	});
	it("estouro: só o gasto", () => {
		const hero = heroModel({
			spentCents: 100000,
			limitCents: 80000,
			availableCents: -20000,
			reservedCents: 5000,
		});
		expect(heroBarParts(shares, hero).map((p) => p.key)).toEqual(["slot-0", "slot-1"]);
	});
	it("sem contas a vencer: sem parte listrada", () => {
		const hero = heroModel({
			spentCents: 100000,
			limitCents: 300000,
			availableCents: 200000,
			reservedCents: 0,
		});
		expect(heroBarParts(shares, hero).some((p) => p.key === RESERVED_KEY)).toBe(false);
	});
});

describe("budgetAlertNotice", () => {
	const names = [
		{ id: "mer", name: "Mercado" },
		{ id: "del", name: "Delivery" },
	];
	const b = (scope: string, alert: boolean) => ({ scope, alert });
	it("sem limite acima do percentual, nada a avisar", () => {
		expect(budgetAlertNotice([b("mer", false), b("total", false)], names, 80)).toBeNull();
		expect(budgetAlertNotice([], names, 80)).toBeNull();
	});
	it("um limite: diz qual; o total tem texto próprio", () => {
		expect(budgetAlertNotice([b("mer", true), b("del", false)], names, 80)).toBe(
			"Mercado passou de 80% do limite",
		);
		expect(budgetAlertNotice([b("total", true)], names, 90)).toBe("O orçamento do mês passou de 90%");
	});
	it("vários limites: conta; categoria que sumiu não quebra", () => {
		expect(budgetAlertNotice([b("mer", true), b("del", true)], names, 80)).toBe("2 limites passaram de 80%");
		expect(budgetAlertNotice([b("fantasma", true)], names, 80)).toBe("1 limite passou de 80%");
	});
});

describe("cardTileInvoices", () => {
	const card = { closingDay: 10, dueDay: 20, closingRule: "closing-day-next" } as const;
	it("fatura fechada que vence neste mês e a aberta (que vence no próximo)", () => {
		expect(cardTileInvoices(card, "2026-11-15")).toEqual({ open: "2026-12", dueThisMonth: "2026-11" });
	});
	it("a aberta que já vence neste mês é a única", () => {
		expect(cardTileInvoices(card, "2026-11-06")).toEqual({ open: "2026-11", dueThisMonth: null });
	});
});
