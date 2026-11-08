import { describe, expect, it } from "vitest";
import { type BreakdownRow, cardGroups, rowCaption, sections } from "./breakdown-model.ts";

const row = (extra: Partial<BreakdownRow>): BreakdownRow => ({
	id: "a",
	branch: "account",
	date: "2026-11-02",
	invoiceMonth: null,
	budgetMonth: "2026-11",
	kind: "expense",
	description: "Mercado",
	amountCents: 1000,
	deltaCents: 1000,
	categoryId: null,
	...extra,
});

describe("sections", () => {
	it("agrupa por ramo na ordem conta, cartão, estimada; ramo vazio some", () => {
		const out = sections(
			[
				row({ id: "c1", branch: "card", date: "2026-10-30", deltaCents: 500 }),
				row({ id: "c2", branch: "card", date: "2026-11-02", deltaCents: 700 }),
			],
			[
				{ branch: "account", count: 0, subtotalCents: 0 },
				{ branch: "card", count: 2, subtotalCents: 1200 },
			],
		);
		expect(out.map((s) => s.branch)).toEqual(["card"]);
		expect(out[0]).toMatchObject({ count: 2, subtotalCents: 1200 });
		expect(out[0]?.rows.map((r) => r.id)).toEqual(["c2", "c1"]);
	});
});

describe("cardGroups", () => {
	it("abre o cartão por cartão, com o subtotal de cada um e as linhas da data mais recente", () => {
		const groups = cardGroups(
			[
				row({ id: "i1", branch: "card", cardId: "inter", date: "2026-11-01", deltaCents: 6919 }),
				row({ id: "s1", branch: "card", cardId: "san", date: "2026-11-03", deltaCents: 500 }),
				row({ id: "i2", branch: "card", cardId: "inter", date: "2026-11-06", deltaCents: 100 }),
				row({ id: "a1", branch: "account", cardId: null }),
			],
			[
				{ cardId: "inter", name: "Inter", last4: "1234", count: 2, subtotalCents: 7019 },
				{ cardId: "san", name: "Santander", last4: null, count: 1, subtotalCents: 500 },
			],
		);
		expect(groups.map((g) => [g.title, g.subtotalCents])).toEqual([
			["Inter •••• 1234", 7019],
			["Santander", 500],
		]);
		expect(groups[0]?.rows.map((r) => r.id)).toEqual(["i2", "i1"]);
	});
});

describe("rowCaption", () => {
	it("conta: só a data; cartão: data e fatura; estorno avisa; estimada não tem data", () => {
		expect(rowCaption(row({}))).toBe("2 de nov");
		expect(rowCaption(row({ invoiceMonth: "2026-11", date: "2026-10-30" }))).toBe(
			"30 de out · fatura de novembro",
		);
		expect(rowCaption(row({ invoiceMonth: "2026-11", kind: "refund" }))).toBe(
			"2 de nov · fatura de novembro · estorno",
		);
	});
});
