import { describe, expect, it } from "vitest";
import {
	barLabel,
	dueShort,
	historyBars,
	invoiceSourceLabel,
	invoiceStateLabel,
	invoiceStateTone,
	invoiceStateWord,
	overviewDefaultMonth,
	selectedBarMonth,
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
		expect(invoiceStateWord("closed")).toBe("Fechada");
		expect(invoiceStateWord("overdue")).toBe("Vencida");
		expect(invoiceSourceLabel("bank")).toBe("Total do banco");
		expect(invoiceSourceLabel("ledger")).toBe("Total estimado pelo Órbita");
	});

	const history = [
		{
			month: "2026-10",
			totalCents: 300,
			state: "overdue" as const,
			byCard: [
				{ cardId: "a", totalCents: 100, state: "paid" as const },
				{ cardId: "b", totalCents: 200, state: "overdue" as const },
			],
		},
		{
			month: "2026-11",
			totalCents: 50,
			state: "closed" as const,
			byCard: [{ cardId: "a", totalCents: 50, state: "closed" as const }],
		},
		{ month: "2026-12", totalCents: 80, state: "open" as const, byCard: [] },
	];

	it("barras: total e situação de todos ou só do cartão (sem fatura no mês: 0 e aberta)", () => {
		expect(historyBars(history, null).map((b) => [b.cents, b.state])).toEqual([
			[300, "overdue"],
			[50, "closed"],
			[80, "open"],
		]);
		expect(historyBars(history, "a").map((b) => [b.month, b.cents, b.state])).toEqual([
			["2026-10", 100, "paid"],
			["2026-11", 50, "closed"],
			["2026-12", 0, "open"],
		]);
	});

	it("mês selecionado: o tocado; senão o padrão; senão o último; barra inexistente é ignorada", () => {
		const bars = historyBars(history, null);
		expect(selectedBarMonth(bars, "2026-10", "2026-11")).toBe("2026-10");
		expect(selectedBarMonth(bars, null, "2026-11")).toBe("2026-11");
		expect(selectedBarMonth(bars, "2025-01", "2026-11")).toBe("2026-11");
		expect(selectedBarMonth(bars, "2025-01", "2030-01")).toBe("2026-12");
		expect(selectedBarMonth(bars, null, null)).toBe("2026-12");
		expect(selectedBarMonth([], "2026-10", "2026-11")).toBeNull();
	});

	it("mês padrão de Todos: o do próximo vencimento; sem ele, o mês de hoje", () => {
		const bars = historyBars(history, null);
		expect(overviewDefaultMonth("2026-11-13", bars, "2026-11-09")).toBe("2026-11");
		expect(overviewDefaultMonth(null, bars, "2026-11-09")).toBe("2026-11");
		expect(overviewDefaultMonth(null, bars, "2027-05-01")).toBeNull();
	});

	it("rótulo falado da barra", () => {
		expect(barLabel("novembro", "R$ 1.200,00", "paid")).toBe("Fatura de novembro, R$ 1.200,00, paga");
		expect(barLabel("dezembro", "R$ 80,00", "open")).toBe("Fatura de dezembro, R$ 80,00, aberta");
	});
});
