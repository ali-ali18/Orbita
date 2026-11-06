import { chart, chartSeries, colors } from "@orbita/tokens";
import { describe, expect, it } from "vitest";
import {
	budgetBarSegments,
	categoryShares,
	currentInvoiceMonth,
	installmentsOverview,
	invoiceCaption,
} from "./summary-model.ts";
import { amountSignMode, initialOf, signedAmount, transactionCaption } from "./transaction-model.ts";

const categories = [
	{ id: "mer", name: "Mercado", chartSlot: 0 },
	{ id: "del", name: "Delivery", chartSlot: 1 },
	{ id: "laz", name: "Lazer", chartSlot: 4 },
	{ id: "mor", name: "Moradia", chartSlot: null },
	{ id: "out", name: "Outros", chartSlot: null },
];

describe("categoryShares", () => {
	it("ordena pelos espaços do gráfico e junta as sem cor em Outros", () => {
		const shares = categoryShares(
			{ laz: 500, mor: 100000, mer: 3000, out: 250, del: 2000, ghost: 50 },
			categories,
		);
		expect(shares.map((s) => s.key)).toEqual(["slot-0", "slot-1", "slot-4", "other"]);
		expect(shares.map((s) => s.color)).toEqual([chartSeries[0], chartSeries[1], chartSeries[4], chart.other]);
		expect(shares.at(-1)).toMatchObject({ name: "Outros", cents: 100300 });
	});
	it("ignora categoria sem gasto e devolve vazio sem dados", () => {
		expect(categoryShares({ mer: 0 }, categories)).toEqual([]);
		expect(categoryShares({}, categories)).toEqual([]);
	});
});

describe("budgetBarSegments", () => {
	const shares = categoryShares({ mer: 60000, del: 40000 }, categories);
	it("completa o limite com o trilho", () => {
		const bar = budgetBarSegments(shares, 300000);
		expect(bar.map((s) => s.weight)).toEqual([60000, 40000, 200000]);
		expect(bar.at(-1)?.color).toBe(colors.surface3);
	});
	it("estourou o limite: sem trilho", () => {
		const bar = budgetBarSegments(shares, 80000);
		expect(bar.map((s) => s.key)).toEqual(["slot-0", "slot-1"]);
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
