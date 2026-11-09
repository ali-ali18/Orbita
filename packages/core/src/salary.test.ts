import { describe, expect, it } from "vitest";
import { findSalaryCredits, type SalaryCredit } from "./salary.ts";

let n = 0;
const credit = (date: string, amountCents: number, payer = "comercio de ervas"): SalaryCredit => ({
	id: `c${++n}`,
	date,
	amountCents,
	payer,
});

const TODAY = "2026-11-09";

describe("findSalaryCredits: pagador recorrente", () => {
	it("o mesmo pagador em dois meses seguidos, com valor parecido, é salário", () => {
		const a = credit("2026-10-05", 230_000);
		const b = credit("2026-11-05", 230_000);
		const found = findSalaryCredits({ credits: [a, b], incomeSources: [], today: TODAY });
		expect([...found.entries()]).toEqual([
			[a.id, "recurring_payer"],
			[b.id, "recurring_payer"],
		]);
	});

	it("uma entrada só não basta", () => {
		const found = findSalaryCredits({
			credits: [credit("2026-11-05", 230_000)],
			incomeSources: [],
			today: TODAY,
		});
		expect(found.size).toBe(0);
	});

	it("valor pequeno (Pix de amigo todo mês) não é salário", () => {
		const found = findSalaryCredits({
			credits: [credit("2026-10-05", 20_000, "joao silva"), credit("2026-11-05", 20_000, "joao silva")],
			incomeSources: [],
			today: TODAY,
		});
		expect(found.size).toBe(0);
	});

	it("pagadores diferentes não se misturam", () => {
		const found = findSalaryCredits({
			credits: [credit("2026-10-05", 230_000, "empresa a"), credit("2026-11-05", 230_000, "empresa b")],
			incomeSources: [],
			today: TODAY,
		});
		expect(found.size).toBe(0);
	});

	it("valor muito diferente ou intervalo fora do mês quebra o padrão", () => {
		expect(
			findSalaryCredits({
				credits: [credit("2026-10-05", 230_000), credit("2026-11-05", 400_000)],
				incomeSources: [],
				today: TODAY,
			}).size,
		).toBe(0);
		expect(
			findSalaryCredits({
				credits: [credit("2026-10-05", 230_000), credit("2026-10-19", 230_000)],
				incomeSources: [],
				today: TODAY,
			}).size,
		).toBe(0);
	});

	it("pagador sem nome (vazio) nunca vira salário por recorrência", () => {
		const found = findSalaryCredits({
			credits: [credit("2026-10-05", 230_000, ""), credit("2026-11-05", 230_000, "")],
			incomeSources: [],
			today: TODAY,
		});
		expect(found.size).toBe(0);
	});
});

describe("findSalaryCredits: renda cadastrada", () => {
	const source = (amountCents: number, payday: number, recurring = true) => ({
		id: "s1",
		amountCents,
		payday,
		recurring,
		month: recurring ? null : ("2026-11" as const),
	});

	it("entrada única com o valor e o dia da renda cadastrada é salário", () => {
		const a = credit("2026-11-05", 230_000, "qualquer");
		const found = findSalaryCredits({ credits: [a], incomeSources: [source(230_000, 5)], today: TODAY });
		expect(found.get(a.id)).toBe("income_plan");
	});

	it("tolera centavos de diferença e antecipação de fim de semana", () => {
		const a = credit("2026-11-03", 231_500, "qualquer");
		const found = findSalaryCredits({ credits: [a], incomeSources: [source(230_000, 5)], today: TODAY });
		expect(found.get(a.id)).toBe("income_plan");
	});

	it("valor ou dia muito diferentes não casam", () => {
		const far = credit("2026-11-20", 230_000, "qualquer");
		const other = credit("2026-11-05", 150_000, "outro");
		const found = findSalaryCredits({
			credits: [far, other],
			incomeSources: [source(230_000, 5)],
			today: TODAY,
		});
		expect(found.size).toBe(0);
	});

	it("renda avulsa (freela) não reconhece salário", () => {
		const a = credit("2026-11-05", 230_000, "qualquer");
		const found = findSalaryCredits({
			credits: [a],
			incomeSources: [source(230_000, 5, false)],
			today: TODAY,
		});
		expect(found.size).toBe(0);
	});

	it("o dia 1º pago no fim do mês anterior ainda casa", () => {
		const a = credit("2026-10-30", 500_000, "qualquer");
		const found = findSalaryCredits({
			credits: [a],
			incomeSources: [source(500_000, 1)],
			today: TODAY,
		});
		expect(found.get(a.id)).toBe("income_plan");
	});
});
