import { describe, expect, it } from "vitest";
import { type AgentScheduleSpec, isDue, latestOccurrence, localClock, weekdayOf } from "./agent-schedule.ts";

// São Paulo é UTC-3 o ano todo (sem horário de verão desde 2019).
const sp = (iso: string) => new Date(`${iso}-03:00`);

describe("localClock e weekdayOf", () => {
	it("usa o fuso de São Paulo", () => {
		expect(localClock(new Date("2026-11-08T01:30:00Z"))).toEqual({ date: "2026-11-07", hour: 22 });
		expect(localClock(new Date("2026-11-08T12:00:00Z"))).toEqual({ date: "2026-11-08", hour: 9 });
		expect(localClock(new Date("2026-11-08T03:00:00Z"))).toEqual({ date: "2026-11-08", hour: 0 });
	});
	it("acha o dia da semana", () => {
		expect(weekdayOf("2026-11-08")).toBe(0); // domingo
		expect(weekdayOf("2026-11-09")).toBe(1);
	});
});

describe("latestOccurrence", () => {
	const daily: AgentScheduleSpec = { frequency: "daily", hour: 9, day: null };
	it("diário: antes da hora vale o dia anterior; depois, hoje", () => {
		expect(latestOccurrence(daily, sp("2026-11-08T08:59:00"))).toEqual({
			date: "2026-11-07",
			hour: 9,
			period: "2026-11-07",
		});
		expect(latestOccurrence(daily, sp("2026-11-08T09:00:00")).period).toBe("2026-11-08");
	});
	const weekly: AgentScheduleSpec = { frequency: "weekly", hour: 9, day: 1 }; // segunda
	it("semanal: a última segunda às 9", () => {
		// 2026-11-08 é domingo; a segunda anterior é 2026-11-02.
		expect(latestOccurrence(weekly, sp("2026-11-08T10:00:00"))).toMatchObject({
			date: "2026-11-02",
			period: "w:2026-11-02",
		});
		// Segunda cedo ainda é a semana passada; depois das 9, é hoje.
		expect(latestOccurrence(weekly, sp("2026-11-09T08:00:00")).period).toBe("w:2026-11-02");
		expect(latestOccurrence(weekly, sp("2026-11-09T09:30:00")).period).toBe("w:2026-11-09");
	});
	const monthly: AgentScheduleSpec = { frequency: "monthly", hour: 8, day: 1 };
	it("mensal: o dia do mês, virando o ano", () => {
		expect(latestOccurrence(monthly, sp("2026-11-08T10:00:00"))).toMatchObject({
			date: "2026-11-01",
			period: "2026-11",
		});
		expect(latestOccurrence(monthly, sp("2026-01-01T07:00:00"))).toMatchObject({
			date: "2025-12-01",
			period: "2025-12",
		});
		expect(latestOccurrence({ ...monthly, day: 28 }, sp("2026-03-10T10:00:00")).date).toBe("2026-02-28");
	});
});

describe("isDue", () => {
	const daily: AgentScheduleSpec = { frequency: "daily", hour: 9, day: null };
	it("nunca rodou: roda", () => {
		expect(isDue(daily, null, sp("2026-11-08T03:00:00"))).toBe(true);
	});
	it("já rodou nesta ocorrência: não roda de novo", () => {
		expect(isDue(daily, sp("2026-11-08T09:05:00"), sp("2026-11-08T09:50:00"))).toBe(false);
		expect(isDue(daily, sp("2026-11-08T09:05:00"), sp("2026-11-08T23:00:00"))).toBe(false);
	});
	it("rodou ontem e já passou da hora de hoje: roda; antes da hora: não", () => {
		const ontem = sp("2026-11-07T09:10:00");
		expect(isDue(daily, ontem, sp("2026-11-08T09:00:00"))).toBe(true);
		expect(isDue(daily, ontem, sp("2026-11-08T08:00:00"))).toBe(false);
	});
	it("worker parado por dias recupera uma execução só", () => {
		const velho = sp("2026-11-01T09:10:00");
		expect(isDue(daily, velho, sp("2026-11-08T10:00:00"))).toBe(true);
		expect(isDue(daily, sp("2026-11-08T10:01:00"), sp("2026-11-08T10:30:00"))).toBe(false);
	});
	it("semanal e mensal", () => {
		const weekly: AgentScheduleSpec = { frequency: "weekly", hour: 9, day: 1 };
		expect(isDue(weekly, sp("2026-11-02T09:05:00"), sp("2026-11-08T12:00:00"))).toBe(false);
		expect(isDue(weekly, sp("2026-11-02T09:05:00"), sp("2026-11-09T09:00:00"))).toBe(true);
		const monthly: AgentScheduleSpec = { frequency: "monthly", hour: 9, day: 5 };
		expect(isDue(monthly, sp("2026-11-05T09:05:00"), sp("2026-11-30T12:00:00"))).toBe(false);
		expect(isDue(monthly, sp("2026-11-05T09:05:00"), sp("2026-12-05T09:00:00"))).toBe(true);
	});
});
