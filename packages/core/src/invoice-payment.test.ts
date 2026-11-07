import { describe, expect, it } from "vitest";
import { type CardConfig, invoiceByMonth } from "./invoice.ts";
import { invoiceMonthOfPayment, paidForInvoice, paymentStatus, paymentWindow } from "./invoice-payment.ts";

// Fecha dia 25, vence dia 5 do mês seguinte: a fatura "2026-11" fecha 25/10 e vence 05/11.
const card: CardConfig = { closingDay: 25, dueDay: 5 };

describe("invoiceMonthOfPayment", () => {
	it.each([
		["2026-10-25", "2026-11"], // no dia do fechamento já vale para a que fechou
		["2026-10-30", "2026-11"], // entre fechar e vencer
		["2026-11-05", "2026-11"], // no vencimento
		["2026-11-20", "2026-11"], // atrasado, ainda antes de fechar a seguinte
		["2026-11-24", "2026-11"], // último dia antes do próximo fechamento
		["2026-11-25", "2026-12"], // fechou a seguinte
		["2026-10-24", "2026-10"], // antes de fechar a de novembro, abate a de outubro
	])("pagamento em %s vale para a fatura %s", (date, month) => {
		expect(invoiceMonthOfPayment(date, card)).toBe(month);
	});

	it("respeita closing-day-included (a compra do dia ainda entra, então o pagamento do dia não)", () => {
		const included: CardConfig = { ...card, closingRule: "closing-day-included" };
		expect(invoiceMonthOfPayment("2026-10-25", included)).toBe("2026-10");
		expect(invoiceMonthOfPayment("2026-10-26", included)).toBe("2026-11");
	});

	it("vira o ano", () => {
		expect(invoiceMonthOfPayment("2026-12-30", card)).toBe("2027-01");
		expect(invoiceMonthOfPayment("2027-01-10", card)).toBe("2027-01");
	});
});

describe("paymentWindow", () => {
	it("a janela de cada fatura é o ciclo que vai do fechamento ao fechamento seguinte", () => {
		expect(paymentWindow("2026-11", card)).toEqual({ from: "2026-10-25", to: "2026-11-24" });
		expect(paymentWindow("2026-12", card)).toEqual({ from: "2026-11-25", to: "2026-12-24" });
	});

	it("as datas das bordas pertencem à própria fatura, e as vizinhas não", () => {
		const { from, to } = paymentWindow("2026-11", card);
		expect(invoiceMonthOfPayment(from, card)).toBe("2026-11");
		expect(invoiceMonthOfPayment(to, card)).toBe("2026-11");
	});
});

describe("paidForInvoice", () => {
	const payments = [
		{ amountCents: 30_000, date: "2026-10-28" },
		{ amountCents: 20_000, date: "2026-11-05" },
		{ amountCents: 99_900, date: "2026-11-26" }, // fatura de dezembro
	];
	it("soma só o que pertence à fatura", () => {
		expect(paidForInvoice(payments, "2026-11", card)).toBe(50_000);
		expect(paidForInvoice(payments, "2026-12", card)).toBe(99_900);
		expect(paidForInvoice(payments, "2027-01", card)).toBe(0);
	});
	it("recusa valor inválido", () => {
		expect(() => paidForInvoice([{ amountCents: 0, date: "2026-11-05" }], "2026-11", card)).toThrow(
			RangeError,
		);
	});
});

describe("paymentStatus", () => {
	const nov = invoiceByMonth("2026-11", card); // fecha 25/10, vence 05/11
	it("aberta enquanto recebe compras, mesmo com valor", () => {
		expect(paymentStatus(nov, 100_000, 0, "2026-10-10")).toBe("open");
		expect(paymentStatus(nov, 100_000, 0, "2026-10-24")).toBe("open");
	});
	it("fechada sem pagamento", () => {
		expect(paymentStatus(nov, 100_000, 0, "2026-10-25")).toBe("unpaid");
		expect(paymentStatus(nov, 100_000, 0, "2026-11-20")).toBe("unpaid"); // vencida e não paga
	});
	it("paga em parte", () => {
		expect(paymentStatus(nov, 100_000, 40_000, "2026-11-01")).toBe("partial");
	});
	it("paga: exato ou a mais", () => {
		expect(paymentStatus(nov, 100_000, 100_000, "2026-11-01")).toBe("paid");
		expect(paymentStatus(nov, 100_000, 120_000, "2026-11-01")).toBe("paid");
	});
	it("fatura fechada sem nada a pagar conta como paga", () => {
		expect(paymentStatus(nov, 0, 0, "2026-11-01")).toBe("paid");
		expect(paymentStatus(nov, -500, 0, "2026-11-01")).toBe("paid");
	});
});
