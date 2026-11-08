import { describe, expect, it } from "vitest";
import { addDays, addMonths, monthOf } from "./dates.ts";
import {
	type CardConfig,
	type ClosingRule,
	invoiceByMonth,
	invoiceFor,
	invoiceStatus,
	nextBestPurchaseDate,
} from "./invoice.ts";

const card = (closingDay: number, dueDay: number, closingRule?: ClosingRule): CardConfig =>
	closingRule ? { closingDay, dueDay, closingRule } : { closingDay, dueDay };

describe("invoiceFor", () => {
	it("vencimento no mesmo mês do fechamento (dueDay > closingDay)", () => {
		const c = card(5, 15);
		expect(invoiceFor("2026-03-04", c)).toMatchObject({
			month: "2026-03",
			closingDate: "2026-03-05",
			dueDate: "2026-03-15",
		});
		expect(invoiceFor("2026-03-06", c)).toMatchObject({
			month: "2026-04",
			closingDate: "2026-04-05",
			dueDate: "2026-04-15",
		});
	});
	it("vencimento no mês seguinte (dueDay <= closingDay)", () => {
		const c = card(25, 5);
		expect(invoiceFor("2026-03-10", c)).toMatchObject({
			month: "2026-04",
			closingDate: "2026-03-25",
			dueDate: "2026-04-05",
		});
		expect(invoiceFor("2026-03-25", c)).toMatchObject({
			month: "2026-05",
			closingDate: "2026-04-25",
			dueDate: "2026-05-05",
		});
	});
	it("compra exatamente no dia do fechamento vai para a próxima fatura", () => {
		const c = card(10, 20);
		expect(invoiceFor("2026-05-09", c).month).toBe("2026-05");
		expect(invoiceFor("2026-05-10", c).month).toBe("2026-06");
	});
	it("fechamento 31 em fevereiro e abril", () => {
		const c = card(31, 10);
		expect(invoiceFor("2026-02-27", c).closingDate).toBe("2026-02-28");
		expect(invoiceFor("2026-02-28", c)).toMatchObject({
			month: "2026-04",
			closingDate: "2026-03-31",
			dueDate: "2026-04-10",
		});
		expect(invoiceFor("2026-04-29", c).closingDate).toBe("2026-04-30");
		expect(invoiceFor("2026-04-30", c).closingDate).toBe("2026-05-31");
		expect(invoiceFor("2024-02-28", c).closingDate).toBe("2024-02-29");
	});
	it("fechamento igual ao vencimento: vence no mês seguinte", () => {
		const c = card(10, 10);
		expect(invoiceFor("2026-05-09", c)).toMatchObject({
			month: "2026-06",
			closingDate: "2026-05-10",
			dueDate: "2026-06-10",
		});
	});
	it("virada de ano", () => {
		const c = card(20, 5);
		expect(invoiceFor("2026-12-10", c)).toMatchObject({
			month: "2027-01",
			closingDate: "2026-12-20",
			dueDate: "2027-01-05",
		});
		expect(invoiceFor("2026-12-20", c)).toMatchObject({
			month: "2027-02",
			closingDate: "2027-01-20",
			dueDate: "2027-02-05",
		});
		expect(invoiceFor("2026-12-31", c).month).toBe("2027-02");
	});
	it("ano bissexto: fechamento 30/31 e vencimento 31 em fevereiro", () => {
		const c = card(30, 31);
		expect(invoiceFor("2024-02-10", c)).toMatchObject({
			month: "2024-02",
			closingDate: "2024-02-29",
			dueDate: "2024-02-29",
		});
		expect(invoiceFor("2023-02-10", c)).toMatchObject({
			month: "2023-02",
			closingDate: "2023-02-28",
			dueDate: "2023-02-28",
		});
	});
	it("cada mês de vencimento tem uma única fatura (sem colisão por mês curto)", () => {
		const c = card(30, 31);
		expect(invoiceFor("2026-02-28", c).month).toBe("2026-03");
		expect(invoiceFor("2026-03-29", c).month).toBe("2026-03");
		expect(invoiceFor("2026-03-30", c).month).toBe("2026-04");
	});
	it("valida entrada", () => {
		expect(() => invoiceFor("2026-02-30", card(5, 10))).toThrow(RangeError);
		expect(() => invoiceFor("2026-02-10", card(0, 10))).toThrow(RangeError);
		expect(() => invoiceFor("2026-02-10", card(5, 32))).toThrow(RangeError);
		expect(() => invoiceFor("2026-02-10", card(5.5, 10))).toThrow(RangeError);
	});
});

describe("invoiceByMonth", () => {
	it("devolve a fatura que vence no mês", () => {
		expect(invoiceByMonth("2026-04", card(25, 5))).toMatchObject({
			month: "2026-04",
			closingDate: "2026-03-25",
			dueDate: "2026-04-05",
		});
		expect(invoiceByMonth("2026-04", card(5, 15))).toMatchObject({
			month: "2026-04",
			closingDate: "2026-04-05",
			dueDate: "2026-04-15",
		});
		expect(invoiceByMonth("2027-01", card(20, 5)).closingDate).toBe("2026-12-20");
	});
});

describe("consistência invoiceFor / invoiceByMonth", () => {
	const configs: CardConfig[] = [];
	for (const closingRule of ["closing-day-next", "closing-day-included"] as const) {
		for (const closingDay of [1, 5, 10, 15, 20, 25, 28, 29, 30, 31]) {
			for (const dueDay of [1, 5, 10, 15, 20, 25, 28, 29, 30, 31])
				configs.push(card(closingDay, dueDay, closingRule));
		}
	}

	it("para toda data: mesma fatura nos dois caminhos e compra entre as faturas vizinhas", () => {
		for (const c of configs) {
			let d = "2023-12-01";
			for (let i = 0; i < 800; i++) {
				const inv = invoiceFor(d, c);
				expect(invoiceByMonth(inv.month, c)).toEqual(inv);
				expect(d <= inv.lastPurchaseDate).toBe(true);
				const previous = invoiceByMonth(addMonths(inv.month, -1), c);
				expect(d > previous.lastPurchaseDate).toBe(true);
				expect(inv.dueDate >= inv.closingDate).toBe(true);
				d = addDays(d, 1);
			}
		}
	}, 30_000);

	it("faturas de meses consecutivos têm fechamentos estritamente crescentes", () => {
		for (const c of configs) {
			let month = "2023-01";
			let last = "";
			for (let i = 0; i < 60; i++) {
				const inv = invoiceByMonth(month, c);
				expect(inv.closingDate > last).toBe(true);
				expect(monthOf(inv.dueDate)).toBe(month);
				last = inv.closingDate;
				month = addMonths(month, 1);
			}
		}
	});
});

describe("closing-day-included", () => {
	const c = card(10, 20, "closing-day-included");
	it("compra no dia do fechamento ainda entra na fatura que fecha", () => {
		expect(invoiceFor("2026-05-10", c)).toEqual({
			month: "2026-05",
			closingDate: "2026-05-10",
			lastPurchaseDate: "2026-05-10",
			dueDate: "2026-05-20",
		});
		expect(invoiceFor("2026-05-11", c).month).toBe("2026-06");
		expect(invoiceFor("2026-05-09", c).month).toBe("2026-05");
	});
	it("a regra padrão difere só no dia do fechamento", () => {
		const def = card(10, 20);
		expect(invoiceFor("2026-05-10", def).month).toBe("2026-06");
		expect(invoiceFor("2026-05-09", def).lastPurchaseDate).toBe("2026-05-09");
	});
	it("fechamento 31 em mês curto", () => {
		const k = card(31, 10, "closing-day-included");
		expect(invoiceFor("2026-02-28", k)).toMatchObject({ closingDate: "2026-02-28", month: "2026-03" });
		expect(invoiceFor("2026-03-01", k).closingDate).toBe("2026-03-31");
	});
	it("melhor dia é o seguinte ao fechamento", () => {
		expect(nextBestPurchaseDate("2026-05-10", c)).toBe("2026-05-11");
		expect(nextBestPurchaseDate("2026-05-11", c)).toBe("2026-05-11");
		expect(nextBestPurchaseDate("2026-05-12", c)).toBe("2026-06-11");
		expect(nextBestPurchaseDate("2026-12-12", c)).toBe("2027-01-11");
		const k = card(31, 10, "closing-day-included");
		expect(nextBestPurchaseDate("2026-03-31", k)).toBe("2026-04-01");
		expect(nextBestPurchaseDate("2026-02-10", k)).toBe("2026-03-01");
		expect(nextBestPurchaseDate("2026-04-01", k)).toBe("2026-04-01");
	});
	it("status: aberta até o dia do fechamento inclusive", () => {
		const inv = invoiceFor("2026-05-01", c);
		expect(invoiceStatus(inv, "2026-05-10")).toBe("open");
		expect(invoiceStatus(inv, "2026-05-11")).toBe("closed");
		expect(invoiceStatus(inv, "2026-05-20")).toBe("closed");
		expect(invoiceStatus(inv, "2026-05-21")).toBe("overdue");
	});
	it("fecha 30 e vence 31 em fevereiro: vai de open direto para overdue", () => {
		const k = card(30, 31, "closing-day-included");
		const inv = invoiceFor("2026-02-10", k);
		expect(inv).toEqual({
			month: "2026-02",
			closingDate: "2026-02-28",
			lastPurchaseDate: "2026-02-28",
			dueDate: "2026-02-28",
		});
		expect(invoiceStatus(inv, "2026-02-28")).toBe("open");
		expect(invoiceStatus(inv, "2026-03-01")).toBe("overdue");
	});
	it("rejeita regra desconhecida", () => {
		// @ts-expect-error valor fora da união, de propósito
		expect(() => invoiceFor("2026-05-10", { closingDay: 10, dueDay: 20, closingRule: "x" })).toThrow(
			RangeError,
		);
	});
});

describe("nextBestPurchaseDate", () => {
	it("nextBestPurchaseDate", () => {
		const c = card(12, 20);
		expect(nextBestPurchaseDate("2026-05-01", c)).toBe("2026-05-12");
		expect(nextBestPurchaseDate("2026-05-12", c)).toBe("2026-05-12");
		expect(nextBestPurchaseDate("2026-05-13", c)).toBe("2026-06-12");
		expect(nextBestPurchaseDate("2026-12-13", c)).toBe("2027-01-12");
		expect(nextBestPurchaseDate("2026-02-10", card(31, 5))).toBe("2026-02-28");
		expect(nextBestPurchaseDate("2026-03-01", card(31, 5))).toBe("2026-03-31");
		expect(nextBestPurchaseDate("2026-03-31", card(31, 5))).toBe("2026-03-31");
		expect(nextBestPurchaseDate("2026-04-01", card(31, 5))).toBe("2026-04-30");
	});
});

describe("invoiceStatus", () => {
	const inv = invoiceFor("2026-05-01", card(10, 20));
	it("aberta antes do fechamento, fechada até o vencimento, vencida depois", () => {
		expect(invoiceStatus(inv, "2026-05-09")).toBe("open");
		expect(invoiceStatus(inv, "2026-05-10")).toBe("closed");
		expect(invoiceStatus(inv, "2026-05-20")).toBe("closed");
		expect(invoiceStatus(inv, "2026-05-21")).toBe("overdue");
	});
	it("valida a data", () => {
		expect(() => invoiceStatus(inv, "2026-02-30")).toThrow(RangeError);
	});
});
