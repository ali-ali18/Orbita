import { describe, expect, it } from "vitest";
import { type BreakdownRow, rowCaption, sections } from "./breakdown-model.ts";

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
	estimated: false,
	...extra,
});

describe("sections", () => {
	it("agrupa por ramo na ordem conta, cartão, estimada; ramo vazio some", () => {
		const out = sections(
			[
				row({ id: "p", branch: "projected", estimated: true }),
				row({ id: "c1", branch: "card", date: "2026-10-30", deltaCents: 500 }),
				row({ id: "c2", branch: "card", date: "2026-11-02", deltaCents: 700 }),
			],
			[
				{ branch: "account", count: 0, subtotalCents: 0 },
				{ branch: "card", count: 2, subtotalCents: 1200 },
				{ branch: "projected", count: 1, subtotalCents: 1000 },
			],
		);
		expect(out.map((s) => s.branch)).toEqual(["card", "projected"]);
		expect(out[0]).toMatchObject({ count: 2, subtotalCents: 1200 });
		expect(out[0]?.rows.map((r) => r.id)).toEqual(["c2", "c1"]);
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
		expect(rowCaption(row({ invoiceMonth: "2026-12", estimated: true }))).toBe(
			"estimada · fatura de dezembro",
		);
	});
});
