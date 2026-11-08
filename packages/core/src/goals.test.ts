import { describe, expect, it } from "vitest";
import { goalPace, goalProgress, goalsTotals, monthlyNeeded, monthsBetween, summarizeGoal } from "./goals.ts";

const TODAY = "2026-11-08";

describe("goalProgress", () => {
	it("percentual inteiro para baixo; 100 só quando atinge", () => {
		expect(goalProgress({ targetCents: 800000, savedCents: 210000 })).toEqual({
			remainingCents: 590000,
			percent: 26,
			reached: false,
		});
		expect(goalProgress({ targetCents: 1000, savedCents: 999 }).percent).toBe(99);
		expect(goalProgress({ targetCents: 1000, savedCents: 1000 })).toMatchObject({
			percent: 100,
			reached: true,
		});
		expect(goalProgress({ targetCents: 1000, savedCents: 1500 })).toEqual({
			remainingCents: 0,
			percent: 100,
			reached: true,
		});
		expect(goalProgress({ targetCents: 1000, savedCents: 0 }).percent).toBe(0);
	});
	it("recusa valor fracionado, meta zero e guardado negativo", () => {
		expect(() => goalProgress({ targetCents: 10.5, savedCents: 0 })).toThrow(RangeError);
		expect(() => goalProgress({ targetCents: 0, savedCents: 0 })).toThrow(RangeError);
		expect(() => goalProgress({ targetCents: 100, savedCents: -1 })).toThrow(RangeError);
	});
});

describe("monthlyNeeded", () => {
	it("divide o que falta pelos meses até o prazo, arredondando para cima", () => {
		expect(monthlyNeeded({ remainingCents: 590000, deadline: "2027-07-31", today: TODAY })).toEqual({
			monthsLeft: 8,
			monthlyCents: 73750,
		});
		expect(monthlyNeeded({ remainingCents: 1001, deadline: "2027-01-10", today: TODAY })).toEqual({
			monthsLeft: 2,
			monthlyCents: 501,
		});
	});
	it("prazo no mês corrente: conta 1 mês", () => {
		expect(monthlyNeeded({ remainingCents: 5000, deadline: "2026-11-30", today: TODAY })).toEqual({
			monthsLeft: 1,
			monthlyCents: 5000,
		});
		expect(monthlyNeeded({ remainingCents: 5000, deadline: TODAY, today: TODAY }).monthsLeft).toBe(1);
	});
	it("prazo vencido: tudo que falta, 0 meses", () => {
		expect(monthlyNeeded({ remainingCents: 5000, deadline: "2026-11-07", today: TODAY })).toEqual({
			monthsLeft: 0,
			monthlyCents: 5000,
		});
	});
	it("atravessa a virada do ano", () => {
		expect(monthsBetween("2026-11", "2027-02")).toBe(3);
		expect(monthsBetween("2027-02", "2026-11")).toBe(-3);
	});
});

describe("goalPace", () => {
	it("média dos últimos 3 meses, contando o corrente", () => {
		const contributions = [
			{ amountCents: 30000, date: "2026-09-05" },
			{ amountCents: 30000, date: "2026-10-05" },
			{ amountCents: 30000, date: "2026-11-05" },
			{ amountCents: 90000, date: "2026-08-20" }, // fora da janela
		];
		expect(goalPace({ createdOn: "2026-06-01", contributions, today: TODAY })).toBe(30000);
	});
	it("meta nova usa só os meses que existiu", () => {
		const contributions = [{ amountCents: 10000, date: "2026-10-20" }];
		expect(goalPace({ createdOn: "2026-10-15", contributions, today: TODAY })).toBe(5000);
		expect(goalPace({ createdOn: "2026-11-01", contributions: [], today: TODAY })).toBe(0);
	});
	it("arredonda para baixo e ignora o que é depois de hoje", () => {
		const contributions = [
			{ amountCents: 100, date: "2026-11-01" },
			{ amountCents: 5000, date: "2026-12-01" },
		];
		expect(goalPace({ createdOn: "2026-09-01", contributions, today: TODAY })).toBe(33);
	});
});

describe("summarizeGoal", () => {
	const base = { targetCents: 800000, deadline: "2027-07-31", createdOn: "2026-08-01" };

	it("no ritmo: o ritmo atual termina antes do prazo", () => {
		const s = summarizeGoal(
			{
				...base,
				contributions: [
					{ amountCents: 80000, date: "2026-09-10" },
					{ amountCents: 80000, date: "2026-10-10" },
					{ amountCents: 80000, date: "2026-11-02" },
				],
			},
			TODAY,
		);
		expect(s).toMatchObject({
			savedCents: 240000,
			remainingCents: 560000,
			percent: 30,
			monthsLeft: 8,
			monthlyNeededCents: 70000,
			paceCents: 80000,
			projectedDate: "2027-06-08",
			status: "on_track",
		});
	});

	it("atrasada: o ritmo não alcança o prazo", () => {
		const s = summarizeGoal(
			{
				targetCents: 100000,
				deadline: "2027-01-31",
				createdOn: "2026-09-01",
				contributions: [{ amountCents: 15000, date: "2026-10-01" }],
			},
			TODAY,
		);
		expect(s.status).toBe("behind");
		expect(s.monthlyNeededCents).toBe(42500);
		expect(s.paceCents).toBe(5000);
		expect(s.projectedDate).toBe("2028-04-08");
	});

	it("ritmo menor que o necessário atrasa; ritmo suficiente fica no ritmo", () => {
		const slow = summarizeGoal(
			{
				targetCents: 30000,
				deadline: "2027-01-31",
				createdOn: "2026-11-01",
				contributions: [{ amountCents: 6000, date: "2026-11-03" }],
			},
			TODAY,
		);
		// falta 24000 em 2 meses = 12000/mês; ritmo 6000/mês.
		expect(slow.monthlyNeededCents).toBe(12000);
		expect(slow.status).toBe("behind");
		const ok = summarizeGoal(
			{
				targetCents: 30000,
				deadline: "2027-01-31",
				createdOn: "2026-11-01",
				contributions: [{ amountCents: 10000, date: "2026-11-03" }],
			},
			TODAY,
		);
		expect(ok.monthlyNeededCents).toBe(10000);
		expect(ok.status).toBe("on_track");
	});

	it("meta nova sem nada guardado ainda não é cobrada", () => {
		const s = summarizeGoal({ ...base, createdOn: TODAY, contributions: [] }, TODAY);
		expect(s).toMatchObject({ status: "on_track", paceCents: 0, projectedDate: null, savedCents: 0 });
		// Nascida no mês passado e sem guardar nada: aí atrasa.
		expect(summarizeGoal({ ...base, createdOn: "2026-10-30", contributions: [] }, TODAY).status).toBe(
			"behind",
		);
	});

	it("atingida: nada a guardar, projeção é hoje", () => {
		const s = summarizeGoal({ ...base, contributions: [{ amountCents: 800000, date: "2026-11-01" }] }, TODAY);
		expect(s).toMatchObject({
			status: "reached",
			percent: 100,
			remainingCents: 0,
			monthlyNeededCents: 0,
			monthsLeft: null,
			projectedDate: TODAY,
		});
	});

	it("prazo vencido e não atingida: atrasada, o que falta é para já", () => {
		const s = summarizeGoal(
			{
				targetCents: 100000,
				deadline: "2026-10-31",
				createdOn: "2026-05-01",
				contributions: [{ amountCents: 40000, date: "2026-10-01" }],
			},
			TODAY,
		);
		expect(s).toMatchObject({ status: "behind", monthsLeft: 0, monthlyNeededCents: 60000 });
	});

	it("sem prazo: sem valor mensal, mas com projeção", () => {
		const s = summarizeGoal(
			{
				targetCents: 100000,
				deadline: null,
				createdOn: "2026-10-01",
				contributions: [{ amountCents: 20000, date: "2026-10-05" }],
			},
			TODAY,
		);
		expect(s).toMatchObject({
			status: "no_deadline",
			monthsLeft: null,
			monthlyNeededCents: null,
			paceCents: 10000,
			projectedDate: "2027-07-08",
		});
	});

	it("dia 31 projeta no último dia do mês curto", () => {
		const s = summarizeGoal(
			{
				targetCents: 20000,
				deadline: null,
				createdOn: "2026-01-01",
				contributions: [{ amountCents: 10000, date: "2026-01-31" }],
			},
			"2026-01-31",
		);
		expect(s.projectedDate).toBe("2026-02-28");
	});

	it("recusa contribuição inválida", () => {
		expect(() => summarizeGoal({ ...base, contributions: [{ amountCents: 0, date: TODAY }] }, TODAY)).toThrow(
			RangeError,
		);
		expect(() =>
			summarizeGoal({ ...base, contributions: [{ amountCents: 1.5, date: TODAY }] }, TODAY),
		).toThrow(RangeError);
		expect(() => summarizeGoal({ ...base, contributions: [] }, "2026-13-01")).toThrow(RangeError);
	});
});

describe("goalsTotals", () => {
	it("soma guardado e alvo", () => {
		expect(
			goalsTotals([
				{ savedCents: 210000, targetCents: 800000 },
				{ savedCents: 120000, targetCents: 300000 },
				{ savedCents: 15000, targetCents: 100000 },
			]),
		).toEqual({ savedCents: 345000, targetCents: 1200000 });
		expect(goalsTotals([])).toEqual({ savedCents: 0, targetCents: 0 });
	});
});
