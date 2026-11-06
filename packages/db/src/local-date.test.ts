import { MAX_INSTALLMENTS } from "@orbita/core";
import { MAX_INSTALLMENT_COUNT } from "@orbita/shared";
import { describe, expect, it } from "vitest";
import { fromDbDate, toDbDate } from "./local-date.ts";

describe("LocalDate <-> @db.Date", () => {
	it.each(["2026-02-28", "2024-02-29", "2026-12-31", "2026-01-01", "1999-12-31"])(
		"%s vai e volta idêntica",
		(d) => {
			expect(fromDbDate(toDbDate(d))).toBe(d);
			expect(toDbDate(d).toISOString()).toBe(`${d}T00:00:00.000Z`);
		},
	);

	it("recusa data que não existe", () => {
		expect(() => toDbDate("2026-02-30")).toThrow(RangeError);
		expect(() => toDbDate("2026-2-3")).toThrow(RangeError);
	});
});

it("o teto de parcelas do shared é o do engine", () => {
	expect(MAX_INSTALLMENT_COUNT).toBe(MAX_INSTALLMENTS);
});
