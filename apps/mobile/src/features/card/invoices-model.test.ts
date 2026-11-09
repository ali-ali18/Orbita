import { describe, expect, it } from "vitest";
import {
	defaultHistoryMonth,
	dueShort,
	historyBars,
	invoiceSourceLabel,
	invoiceStateLabel,
	invoiceStateTone,
} from "./invoices-model.ts";

describe("faturas: visão geral", () => {
	it("situação honesta da fatura", () => {
		expect(invoiceStateLabel({ state: "paid", dueDate: "2026-11-07" })).toBe("Paga");
		expect(invoiceStateLabel({ state: "closed", dueDate: "2026-11-13" })).toBe("Fechada · vence 13/11");
		expect(invoiceStateLabel({ state: "overdue", dueDate: "2026-11-03" })).toBe("Vencida · venceu 03/11");
		expect(invoiceStateLabel({ state: "open", dueDate: "2026-12-08" })).toBe("Aberta");
		expect(dueShort("2026-01-09")).toBe("09/01");
	});

	it("só a paga é verde", () => {
		expect(invoiceStateTone("paid")).toBe("positive");
		expect(invoiceStateTone("overdue")).toBe("primary");
		expect(invoiceStateTone("open")).toBe("secondary");
	});

	it("diz de onde vem o total", () => {
		expect(invoiceSourceLabel("bank")).toBe("Total do banco");
		expect(invoiceSourceLabel("ledger")).toBe("Total estimado pelo Órbita");
	});

	it("barras: total ou só do cartão; destaca o mês aberto", () => {
		const history = [
			{
				month: "2026-10",
				totalCents: 300,
				open: false,
				byCard: [
					{ cardId: "a", totalCents: 100 },
					{ cardId: "b", totalCents: 200 },
				],
			},
			{ month: "2026-11", totalCents: 50, open: true, byCard: [{ cardId: "a", totalCents: 50 }] },
		];
		expect(historyBars(history, null).map((b) => b.cents)).toEqual([300, 50]);
		expect(historyBars(history, "b").map((b) => b.cents)).toEqual([200, 0]);
		expect(defaultHistoryMonth(historyBars(history, null))).toBe("2026-11");
		expect(defaultHistoryMonth([{ month: "2026-09", cents: 1, open: false }])).toBe("2026-09");
		expect(defaultHistoryMonth([])).toBeNull();
	});
});
