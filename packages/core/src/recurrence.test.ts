import { describe, expect, it } from "vitest";
import { type MonthlyRecurrence, nextOccurrence, occurrencesInMonth, pendingInMonth } from "./recurrence.ts";

describe("occurrencesInMonth", () => {
	const rule = { dayOfMonth: 31, startDate: "2020-01-01" };
	it("dia 31 cai no último dia dos meses curtos", () => {
		expect(occurrencesInMonth(rule, "2026-02")).toEqual(["2026-02-28"]);
		expect(occurrencesInMonth(rule, "2024-02")).toEqual(["2024-02-29"]);
		expect(occurrencesInMonth(rule, "2026-04")).toEqual(["2026-04-30"]);
		expect(occurrencesInMonth(rule, "2026-05")).toEqual(["2026-05-31"]);
	});
	it("respeita início e fim (inclusive)", () => {
		const r = { dayOfMonth: 10, startDate: "2026-03-10", endDate: "2026-06-10" };
		expect(occurrencesInMonth(r, "2026-02")).toEqual([]);
		expect(occurrencesInMonth(r, "2026-03")).toEqual(["2026-03-10"]);
		expect(occurrencesInMonth(r, "2026-06")).toEqual(["2026-06-10"]);
		expect(occurrencesInMonth(r, "2026-07")).toEqual([]);
	});
	it("mês de início com o dia já passado não tem ocorrência", () => {
		const r = { dayOfMonth: 5, startDate: "2026-03-06" };
		expect(occurrencesInMonth(r, "2026-03")).toEqual([]);
		expect(occurrencesInMonth(r, "2026-04")).toEqual(["2026-04-05"]);
	});
	it("fim antes do dia no último mês", () => {
		const r = { dayOfMonth: 20, startDate: "2026-01-01", endDate: "2026-06-19" };
		expect(occurrencesInMonth(r, "2026-06")).toEqual([]);
	});
	it("valida a regra", () => {
		expect(() => occurrencesInMonth({ dayOfMonth: 0, startDate: "2026-01-01" }, "2026-01")).toThrow(
			RangeError,
		);
		expect(() => occurrencesInMonth({ dayOfMonth: 32, startDate: "2026-01-01" }, "2026-01")).toThrow(
			RangeError,
		);
		expect(() => occurrencesInMonth({ dayOfMonth: 5, startDate: "2026-02-30" }, "2026-01")).toThrow(
			RangeError,
		);
		expect(() =>
			occurrencesInMonth({ dayOfMonth: 5, startDate: "2026-02-01", endDate: "2026-01-01" }, "2026-01"),
		).toThrow(RangeError);
		expect(() => occurrencesInMonth({ dayOfMonth: 5, startDate: "2026-01-01" }, "2026-13")).toThrow(
			RangeError,
		);
	});
});

describe("nextOccurrence", () => {
	const rule = { dayOfMonth: 15, startDate: "2026-01-01", endDate: "2026-12-31" };
	it("from igual à ocorrência devolve ela mesma", () => {
		expect(nextOccurrence(rule, "2026-05-15")).toBe("2026-05-15");
	});
	it("depois da ocorrência do mês, vai para o mês seguinte", () => {
		expect(nextOccurrence(rule, "2026-05-16")).toBe("2026-06-15");
		expect(nextOccurrence(rule, "2026-05-01")).toBe("2026-05-15");
	});
	it("antes do início devolve a primeira ocorrência", () => {
		expect(nextOccurrence({ dayOfMonth: 5, startDate: "2026-03-06" }, "2025-01-01")).toBe("2026-04-05");
		expect(nextOccurrence({ dayOfMonth: 5, startDate: "2026-03-01" }, "2020-01-01")).toBe("2026-03-05");
	});
	it("dia 31 e meses curtos", () => {
		const r = { dayOfMonth: 31, startDate: "2026-01-01" };
		expect(nextOccurrence(r, "2026-02-01")).toBe("2026-02-28");
		expect(nextOccurrence(r, "2026-02-28")).toBe("2026-02-28");
		expect(nextOccurrence(r, "2026-03-01")).toBe("2026-03-31");
		expect(nextOccurrence(r, "2026-04-30")).toBe("2026-04-30");
	});
	it("virada de ano", () => {
		const r = { dayOfMonth: 10, startDate: "2026-01-01" };
		expect(nextOccurrence(r, "2026-12-11")).toBe("2027-01-10");
	});
	it("regra encerrada devolve undefined", () => {
		expect(nextOccurrence(rule, "2026-12-16")).toBeUndefined();
		expect(nextOccurrence(rule, "2027-03-01")).toBeUndefined();
	});
});

describe("pendingInMonth", () => {
	const rules: MonthlyRecurrence[] = [
		{ dayOfMonth: 5, startDate: "2026-01-01", amountCents: 150000 },
		{ dayOfMonth: 20, startDate: "2026-01-01", amountCents: 3990 },
		{ dayOfMonth: 31, startDate: "2026-01-01", amountCents: 1000 },
		{ dayOfMonth: 25, startDate: "2026-01-01", endDate: "2026-04-30", amountCents: 7777 },
		{ dayOfMonth: 25, startDate: "2026-07-01", amountCents: 8888 },
	];
	it("soma só o que cai hoje ou depois", () => {
		expect(pendingInMonth(rules, "2026-05", "2026-05-10")).toBe(3990 + 1000);
		expect(pendingInMonth(rules, "2026-05", "2026-05-20")).toBe(3990 + 1000);
		expect(pendingInMonth(rules, "2026-05", "2026-05-21")).toBe(1000);
		expect(pendingInMonth(rules, "2026-05", "2026-05-31")).toBe(1000);
	});
	it("mês inteiro pendente quando hoje é anterior ao mês", () => {
		expect(pendingInMonth(rules, "2026-05", "2026-04-30")).toBe(150000 + 3990 + 1000);
	});
	it("mês já passado não tem pendente", () => {
		expect(pendingInMonth(rules, "2026-05", "2026-06-01")).toBe(0);
	});
	it("respeita fim e início", () => {
		expect(pendingInMonth(rules, "2026-04", "2026-04-01")).toBe(150000 + 3990 + 1000 + 7777);
		expect(pendingInMonth(rules, "2026-07", "2026-07-01")).toBe(150000 + 3990 + 1000 + 8888);
	});
	it("sem regras", () => {
		expect(pendingInMonth([], "2026-05", "2026-05-01")).toBe(0);
	});
});
