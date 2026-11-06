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
	const rent: MonthlyRecurrence = {
		id: "rent",
		kind: "expense",
		dayOfMonth: 5,
		startDate: "2026-01-01",
		amountCents: 150000,
	};
	const salary: MonthlyRecurrence = {
		id: "salary",
		kind: "income",
		dayOfMonth: 5,
		startDate: "2026-01-01",
		amountCents: 800000,
	};
	const netflix: MonthlyRecurrence = {
		id: "netflix",
		kind: "expense",
		dayOfMonth: 20,
		startDate: "2026-01-01",
		amountCents: 3990,
	};
	const ended: MonthlyRecurrence = {
		id: "old",
		kind: "expense",
		dayOfMonth: 25,
		startDate: "2026-01-01",
		endDate: "2026-04-30",
		amountCents: 7777,
	};
	const later: MonthlyRecurrence = {
		id: "later",
		kind: "expense",
		dayOfMonth: 25,
		startDate: "2026-07-01",
		amountCents: 8888,
	};

	it("salário e aluguel: receita nunca entra como gasto pendente", () => {
		expect(pendingInMonth([salary, rent], "2026-05", [])).toEqual({
			expenseCents: 150000,
			incomeCents: 800000,
		});
	});
	it("o que já foi lançado no mês não é pendente, nem a data sendo hoje nem paga adiantada", () => {
		const posted = [{ recurrenceId: "rent", month: "2026-05" }];
		expect(pendingInMonth([rent, netflix], "2026-05", posted)).toEqual({
			expenseCents: 3990,
			incomeCents: 0,
		});
	});
	it("conta vencida e ainda não lançada continua esperada", () => {
		// Nenhuma noção de "hoje": a data do aluguel (dia 5) pode já ter passado.
		expect(pendingInMonth([rent], "2026-05", [])).toEqual({ expenseCents: 150000, incomeCents: 0 });
	});
	it("lançamento de outro mês ou de outra recorrência não conta", () => {
		const posted = [
			{ recurrenceId: "rent", month: "2026-04" },
			{ recurrenceId: "other", month: "2026-05" },
		];
		expect(pendingInMonth([rent], "2026-05", posted).expenseCents).toBe(150000);
	});
	it("receita lançada some do pendente", () => {
		const r = pendingInMonth([salary, rent], "2026-05", [{ recurrenceId: "salary", month: "2026-05" }]);
		expect(r).toEqual({ expenseCents: 150000, incomeCents: 0 });
	});
	it("respeita fim e início", () => {
		expect(pendingInMonth([rent, ended, later], "2026-04", []).expenseCents).toBe(150000 + 7777);
		expect(pendingInMonth([rent, ended, later], "2026-05", []).expenseCents).toBe(150000);
		expect(pendingInMonth([rent, ended, later], "2026-07", []).expenseCents).toBe(150000 + 8888);
	});
	it("sem regras", () => {
		expect(pendingInMonth([], "2026-05", [])).toEqual({ expenseCents: 0, incomeCents: 0 });
	});
	it("kind inválido lança TypeError, sem cair em receita", () => {
		for (const kind of ["Expense", "", "transfer", undefined]) {
			// @ts-expect-error kind fora da união, de propósito
			const bad: MonthlyRecurrence = { ...rent, kind };
			expect(() => pendingInMonth([bad], "2026-05", [])).toThrow(TypeError);
		}
	});
	it("valor deve ser inteiro positivo", () => {
		for (const amountCents of [0, -100, 1.5, Number.NaN, 2 ** 53]) {
			expect(() => pendingInMonth([{ ...rent, amountCents }], "2026-05", [])).toThrow(RangeError);
		}
	});
	it("dia e datas inválidos lançam, mesmo se a recorrência já foi lançada", () => {
		const posted = [{ recurrenceId: "rent", month: "2026-05" }];
		expect(() => pendingInMonth([{ ...rent, dayOfMonth: 0 }], "2026-05", posted)).toThrow(RangeError);
		expect(() => pendingInMonth([{ ...rent, dayOfMonth: 32 }], "2026-05", posted)).toThrow(RangeError);
		expect(() => pendingInMonth([{ ...rent, startDate: "2026-02-30" }], "2026-05", posted)).toThrow(
			RangeError,
		);
		expect(() => pendingInMonth([{ ...rent, endDate: "2025-01-01" }], "2026-05", posted)).toThrow(RangeError);
		expect(() => pendingInMonth([{ ...rent, endDate: "xx" }], "2026-05", posted)).toThrow(RangeError);
	});
	it("valida o mês", () => {
		expect(() => pendingInMonth([], "2026-13", [])).toThrow(RangeError);
	});
});
