import { describe, expect, it } from "vitest";
import { installmentSchedule, remainingInstallments, splitInstallments } from "./installments.ts";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("splitInstallments", () => {
	it("1 parcela é o total", () => {
		expect(splitInstallments(12345, 1)).toEqual([12345]);
	});
	it("resto vai para a primeira parcela", () => {
		expect(splitInstallments(10000, 3)).toEqual([3334, 3333, 3333]);
		expect(splitInstallments(10001, 3)).toEqual([3335, 3333, 3333]);
		expect(splitInstallments(10000, 4)).toEqual([2500, 2500, 2500, 2500]);
	});
	it("total menor que a quantidade de parcelas", () => {
		const parts = splitInstallments(2, 3);
		expect(parts).toEqual([2, 0, 0]);
	});
	it("máximo de 72 parcelas e soma sempre fecha", () => {
		const parts = splitInstallments(999_999_99, 72);
		expect(parts).toHaveLength(72);
		for (let count = 1; count <= 72; count++) {
			for (const total of [1, 99, 10000, 123457, 99999999]) {
				const p = splitInstallments(total, count);
				expect(sum(p)).toBe(total);
				expect(Math.max(...p) - Math.min(...p)).toBeLessThan(count);
				expect(p[0]).toBe(Math.max(...p));
			}
		}
	});
	it("rejeita entrada inválida", () => {
		expect(() => splitInstallments(0, 3)).toThrow(RangeError);
		expect(() => splitInstallments(-100, 3)).toThrow(RangeError);
		expect(() => splitInstallments(100.5, 3)).toThrow(RangeError);
		expect(() => splitInstallments(100, 0)).toThrow(RangeError);
		expect(() => splitInstallments(100, 73)).toThrow(RangeError);
		expect(() => splitInstallments(100, 2.5)).toThrow(RangeError);
	});
});

describe("installmentSchedule", () => {
	const card = { closingDay: 10, dueDay: 20 };
	it("parcela 1 na fatura da compra, depois um mês a cada parcela", () => {
		const s = installmentSchedule({ purchaseDate: "2026-05-09", totalCents: 10000, count: 3, card });
		expect(s).toEqual([
			{ number: 1, count: 3, amountCents: 3334, invoiceMonth: "2026-05" },
			{ number: 2, count: 3, amountCents: 3333, invoiceMonth: "2026-06" },
			{ number: 3, count: 3, amountCents: 3333, invoiceMonth: "2026-07" },
		]);
	});
	it("compra no fechamento começa na fatura seguinte", () => {
		const s = installmentSchedule({ purchaseDate: "2026-05-10", totalCents: 5000, count: 1, card });
		expect(s).toEqual([{ number: 1, count: 1, amountCents: 5000, invoiceMonth: "2026-06" }]);
	});
	it("atravessa a virada do ano", () => {
		const s = installmentSchedule({ purchaseDate: "2026-11-20", totalCents: 60000, count: 4, card });
		expect(s.map((i) => i.invoiceMonth)).toEqual(["2026-12", "2027-01", "2027-02", "2027-03"]);
	});
	it("72 parcelas terminam 71 meses depois", () => {
		const s = installmentSchedule({ purchaseDate: "2026-01-01", totalCents: 720000, count: 72, card });
		expect(s[0]?.invoiceMonth).toBe("2026-01");
		expect(s[71]?.invoiceMonth).toBe("2031-12");
		expect(sum(s.map((i) => i.amountCents))).toBe(720000);
	});
});

describe("remainingInstallments", () => {
	const schedule = installmentSchedule({
		purchaseDate: "2026-11-01",
		totalCents: 10000,
		count: 3,
		card: { closingDay: 10, dueDay: 20 },
	});
	it("antes da primeira fatura nada foi pago", () => {
		expect(remainingInstallments(schedule, "2026-11")).toEqual({
			paidCents: 0,
			remainingCents: 10000,
			paidCount: 0,
			remainingCount: 3,
		});
	});
	it("a parcela da fatura atual ainda falta", () => {
		expect(remainingInstallments(schedule, "2027-01")).toEqual({
			paidCents: 6667,
			remainingCents: 3333,
			paidCount: 2,
			remainingCount: 1,
		});
	});
	it("tudo pago depois da última fatura", () => {
		expect(remainingInstallments(schedule, "2027-02")).toEqual({
			paidCents: 10000,
			remainingCents: 0,
			paidCount: 3,
			remainingCount: 0,
		});
	});
	it("parcelamento vazio", () => {
		expect(remainingInstallments([], "2026-01")).toEqual({
			paidCents: 0,
			remainingCents: 0,
			paidCount: 0,
			remainingCount: 0,
		});
	});
});
