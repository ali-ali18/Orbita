import { describe, expect, it } from "vitest";
import {
	addDays,
	addMonths,
	clampDay,
	clampDayInMonth,
	compareLocalDate,
	daysBetween,
	daysInMonth,
	formatLocalDate,
	formatMonthKey,
	isLeapYear,
	isValidLocalDate,
	monthOf,
	parseLocalDate,
	parseMonthKey,
	toLocalDate,
} from "./dates.ts";

describe("toLocalDate", () => {
	it("usa o fuso de São Paulo por padrão (UTC-3)", () => {
		expect(toLocalDate(new Date("2026-03-01T02:30:00Z"))).toBe("2026-02-28");
		expect(toLocalDate(new Date("2026-03-01T03:00:00Z"))).toBe("2026-03-01");
	});
	it("aceita outro fuso", () => {
		expect(toLocalDate(new Date("2026-03-01T02:30:00Z"), "UTC")).toBe("2026-03-01");
		expect(toLocalDate(new Date("2026-03-01T14:30:00Z"), "Asia/Tokyo")).toBe("2026-03-01");
		expect(toLocalDate(new Date("2026-03-01T15:00:00Z"), "Asia/Tokyo")).toBe("2026-03-02");
	});
	it("rejeita instante inválido", () => {
		expect(() => toLocalDate(new Date(Number.NaN))).toThrow(RangeError);
	});
});

describe("validação", () => {
	it("isValidLocalDate checa o calendário real", () => {
		expect(isValidLocalDate("2024-02-29")).toBe(true);
		expect(isValidLocalDate("2023-02-29")).toBe(false);
		expect(isValidLocalDate("1900-02-29")).toBe(false);
		expect(isValidLocalDate("2000-02-29")).toBe(true);
		expect(isValidLocalDate("2026-04-31")).toBe(false);
		expect(isValidLocalDate("2026-13-01")).toBe(false);
		expect(isValidLocalDate("2026-00-10")).toBe(false);
		expect(isValidLocalDate("2026-1-1")).toBe(false);
		expect(isValidLocalDate("")).toBe(false);
	});
	it("parseLocalDate e parseMonthKey", () => {
		expect(parseLocalDate("2026-11-06")).toEqual({ year: 2026, month: 11, day: 6 });
		expect(() => parseLocalDate("2026-02-30")).toThrow(RangeError);
		expect(parseMonthKey("2026-11")).toEqual({ year: 2026, month: 11 });
		expect(() => parseMonthKey("2026-13")).toThrow(RangeError);
		expect(() => parseMonthKey("2026-1")).toThrow(RangeError);
	});
	it("formatadores", () => {
		expect(formatLocalDate(2026, 1, 5)).toBe("2026-01-05");
		expect(formatMonthKey(2026, 1)).toBe("2026-01");
	});
});

describe("calendário", () => {
	it("daysInMonth e anos bissextos", () => {
		expect(daysInMonth(2024, 2)).toBe(29);
		expect(daysInMonth(2023, 2)).toBe(28);
		expect(daysInMonth(2100, 2)).toBe(28);
		expect(daysInMonth(2026, 4)).toBe(30);
		expect(daysInMonth(2026, 12)).toBe(31);
		expect(isLeapYear(2000)).toBe(true);
		expect(() => daysInMonth(2026, 13)).toThrow(RangeError);
		expect(() => daysInMonth(0, 1)).toThrow(RangeError);
	});
	it("addMonths atravessa o ano nos dois sentidos", () => {
		expect(addMonths("2026-11", 2)).toBe("2027-01");
		expect(addMonths("2026-01", -1)).toBe("2025-12");
		expect(addMonths("2026-06", 0)).toBe("2026-06");
		expect(addMonths("2026-01", -13)).toBe("2024-12");
		expect(addMonths("2026-01", 24)).toBe("2028-01");
		expect(() => addMonths("2026-01", 1.5)).toThrow(RangeError);
		expect(() => addMonths("0001-01", -1)).toThrow(RangeError);
	});
	it("monthOf", () => {
		expect(monthOf("2026-02-28")).toBe("2026-02");
	});
	it("clampDay", () => {
		expect(clampDay(2026, 2, 31)).toBe("2026-02-28");
		expect(clampDay(2024, 2, 31)).toBe("2024-02-29");
		expect(clampDay(2026, 4, 31)).toBe("2026-04-30");
		expect(clampDay(2026, 1, 31)).toBe("2026-01-31");
		expect(clampDayInMonth("2026-04", 31)).toBe("2026-04-30");
		expect(() => clampDay(2026, 1, 0)).toThrow(RangeError);
		expect(() => clampDay(2026, 1, 32)).toThrow(RangeError);
	});
	it("addDays", () => {
		expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
		expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
		expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
		expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
		expect(addDays("2026-03-01", 0)).toBe("2026-03-01");
		expect(addDays("2026-01-01", 365)).toBe("2027-01-01");
		expect(() => addDays("2026-01-01", 0.5)).toThrow(RangeError);
		expect(() => addDays("9999-12-31", 1)).toThrow(RangeError);
	});
	it("compareLocalDate e daysBetween", () => {
		expect(compareLocalDate("2026-01-01", "2026-01-02")).toBe(-1);
		expect(compareLocalDate("2026-01-02", "2026-01-01")).toBe(1);
		expect(compareLocalDate("2026-01-01", "2026-01-01")).toBe(0);
		expect(daysBetween("2026-01-01", "2026-03-01")).toBe(59);
		expect(daysBetween("2024-01-01", "2025-01-01")).toBe(366);
		expect(daysBetween("2026-03-01", "2026-01-01")).toBe(-59);
	});
	it("addDays e daysBetween são coerentes por vários anos", () => {
		let d = "1999-12-25";
		for (let i = 0; i < 3000; i++) {
			const next = addDays(d, 1);
			expect(daysBetween(d, next)).toBe(1);
			expect(isValidLocalDate(next)).toBe(true);
			d = next;
		}
		expect(d).toBe(addDays("1999-12-25", 3000));
	});
});
