import { describe, expect, it } from "vitest";
import { type IncomeSource, incomeForMonth, nextPayday } from "./income.ts";

const salary: IncomeSource = { id: "s", amountCents: 230000, payday: 5, recurring: true, month: null };
const freela: IncomeSource = { id: "f", amountCents: 50000, payday: 20, recurring: false, month: "2026-11" };

describe("incomeForMonth", () => {
	it("recorrente conta todo mês; avulsa só no mês dela", () => {
		expect(incomeForMonth([salary, freela], "2026-11")).toBe(280000);
		expect(incomeForMonth([salary, freela], "2026-12")).toBe(230000);
		expect(incomeForMonth([], "2026-12")).toBe(0);
	});
	it("recusa fonte inválida", () => {
		expect(() => incomeForMonth([{ ...salary, payday: 32 }], "2026-11")).toThrow(RangeError);
		expect(() => incomeForMonth([{ ...salary, recurring: false }], "2026-11")).toThrow(RangeError);
		expect(() => incomeForMonth([{ ...salary, amountCents: 0 }], "2026-11")).toThrow(RangeError);
	});
});

describe("nextPayday", () => {
	it("hoje conta; depois do dia, vai para o mês seguinte", () => {
		expect(nextPayday([salary], "2026-11-05")).toEqual({ sourceId: "s", date: "2026-11-05", daysUntil: 0 });
		expect(nextPayday([salary], "2026-11-08")).toEqual({ sourceId: "s", date: "2026-12-05", daysUntil: 27 });
	});
	it("dia 31 cai no último dia do mês curto", () => {
		const s = { ...salary, payday: 31 };
		expect(nextPayday([s], "2027-02-10")).toEqual({ sourceId: "s", date: "2027-02-28", daysUntil: 18 });
	});
	it("pega o mais próximo; avulsa passada é ignorada; sem fonte, nulo", () => {
		expect(nextPayday([salary, freela], "2026-11-08")?.sourceId).toBe("f");
		expect(nextPayday([freela], "2026-11-21")).toBeNull();
		expect(nextPayday([], "2026-11-21")).toBeNull();
	});
	it("empate no dia: maior valor", () => {
		const other = { ...freela, id: "a", month: null, recurring: true, payday: 5, amountCents: 1000 };
		expect(nextPayday([other, salary], "2026-11-01")?.sourceId).toBe("s");
	});
});
