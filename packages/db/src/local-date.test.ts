import { MAX_INSTALLMENTS } from "@orbita/core";
import { MAX_INSTALLMENT_COUNT } from "@orbita/shared";
import { describe, expect, it } from "vitest";
import { fromDbDate, toDbDate } from "./local-date.ts";

describe("LocalDate <-> @db.Date", () => {
	it("o teste roda fora de UTC (senão não pegaria data andando com o fuso)", () => {
		expect(new Date(2026, 0, 15).getTimezoneOffset()).toBe(180);
	});

	it("uma conversão ingênua (fuso local) andaria um dia; a nossa não", () => {
		// Meia-noite UTC de 28/02 é 21h de 27/02 em São Paulo.
		const midnightUtc = new Date("2026-02-28T00:00:00.000Z");
		expect(midnightUtc.getDate()).toBe(27);
		expect(fromDbDate(midnightUtc)).toBe("2026-02-28");
	});

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
