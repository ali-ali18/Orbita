import { describe, expect, it } from "vitest";
import { type InstallmentRowView, installmentStanding } from "./installment-standing.ts";

const row = (number: number, count: number, amountCents: number, invoiceMonth: string) =>
	({ number, count, amountCents, invoiceMonth }) satisfies InstallmentRowView;

describe("installmentStanding", () => {
	it("11 de 21 visto só pela parcela do mês: as 10 anteriores são estimadas", () => {
		const s = installmentStanding([row(11, 21, 8687, "2026-12")], 21, "2026-12");
		expect(s).toMatchObject({
			count: 21,
			currentNumber: 11,
			installmentCents: 8687,
			paidCount: 10,
			paidCents: 86870,
			paidEstimated: true,
			remainingCount: 11,
			remainingCents: 11 * 8687,
			remainingEstimated: true,
			totalCents: 21 * 8687,
			committedMonthCents: 8687,
			// vigente na fatura 2026-12; faltam 10 depois dela
			lastInvoiceMonth: "2027-10",
		});
	});

	it("parcelas vistas não são estimadas; a vigente é a de maior número que já pesou", () => {
		const rows = [row(1, 3, 3334, "2026-09"), row(2, 3, 3333, "2026-10"), row(3, 3, 3333, "2026-11")];
		const s = installmentStanding(rows, 3, "2026-10");
		expect(s).toMatchObject({
			currentNumber: 2,
			paidCount: 1,
			paidCents: 3334,
			paidEstimated: false,
			remainingCount: 2,
			remainingCents: 6666,
			remainingEstimated: false,
			committedMonthCents: 3333,
			lastInvoiceMonth: "2026-11",
		});
	});

	it("nada pesou ainda: nada pago, tudo falta", () => {
		const s = installmentStanding([row(1, 2, 5000, "2026-12")], 2, "2026-11");
		expect(s).toMatchObject({
			currentNumber: null,
			paidCount: 0,
			remainingCount: 2,
			remainingCents: 10000,
			remainingEstimated: true,
			committedMonthCents: 0,
			lastInvoiceMonth: "2027-01",
		});
	});

	it("última parcela já vista: falta só ela", () => {
		const s = installmentStanding([row(10, 10, 1000, "2026-11")], 10, "2026-11");
		expect(s).toMatchObject({ paidCount: 9, paidCents: 9000, remainingCount: 1, remainingCents: 1000 });
		expect(s.lastInvoiceMonth).toBe("2026-11");
	});
});
