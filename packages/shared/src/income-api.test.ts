import { describe, expect, it } from "vitest";
import { incomeSourceCreateBody, incomeSourceUpdateBody, planApplyBody, planQuery } from "./income-api.ts";

describe("renda", () => {
	it("salário: recorrente por padrão, em centavos inteiros", () => {
		const ok = incomeSourceCreateBody.parse({ name: " Salário ", amountCents: 230000, payday: 5 });
		expect(ok).toMatchObject({ name: "Salário", recurring: true, amountCents: 230000, payday: 5 });
	});
	it("recusa valor em reais, dia fora de 1 a 31 e campo desconhecido", () => {
		expect(incomeSourceCreateBody.safeParse({ name: "x", amountCents: 2300.5, payday: 5 }).success).toBe(
			false,
		);
		expect(incomeSourceCreateBody.safeParse({ name: "x", amountCents: 100, payday: 32 }).success).toBe(false);
		expect(incomeSourceCreateBody.safeParse({ name: "x", amountCents: 0, payday: 1 }).success).toBe(false);
		expect(incomeSourceCreateBody.safeParse({ name: "x", amountCents: 1, payday: 1, extra: 1 }).success).toBe(
			false,
		);
	});
	it("avulsa precisa de mês", () => {
		const bad = incomeSourceCreateBody.safeParse({
			name: "Freela",
			amountCents: 5000,
			payday: 20,
			recurring: false,
		});
		expect(bad.success).toBe(false);
		expect(
			incomeSourceCreateBody.safeParse({
				name: "Freela",
				amountCents: 5000,
				payday: 20,
				recurring: false,
				month: "2026-11",
			}).success,
		).toBe(true);
	});
	it("atualização pede ao menos um campo", () => {
		expect(incomeSourceUpdateBody.safeParse({}).success).toBe(false);
		expect(incomeSourceUpdateBody.safeParse({ accountId: null }).success).toBe(true);
	});
	it("reserva do plano: inteiro de 0 a 100", () => {
		expect(planQuery.parse({ reservePercent: "15" }).reservePercent).toBe(15);
		expect(planQuery.safeParse({ reservePercent: "101" }).success).toBe(false);
		expect(planApplyBody.safeParse({ reservePercent: 10.5 }).success).toBe(false);
	});
});
