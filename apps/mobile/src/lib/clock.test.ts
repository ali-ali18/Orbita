import { describe, expect, it } from "vitest";
import { clockAt, nextClock } from "./clock.ts";

describe("relógio do app", () => {
	it("usa o fuso de São Paulo para dia, mês e hora", () => {
		// 02:30 UTC de 1º/12 ainda é 30/11 23:30 em São Paulo.
		expect(clockAt(new Date("2026-12-01T02:30:00Z"))).toEqual({
			today: "2026-11-30",
			month: "2026-11",
			hour: 23,
		});
	});
	it("devolve o mesmo objeto quando nada mudou", () => {
		const a = clockAt(new Date("2026-11-06T15:00:00Z"));
		expect(nextClock(a, new Date("2026-11-06T15:20:00Z"))).toBe(a);
	});
	it("vira o mês quando a data muda (app volta do segundo plano no dia seguinte)", () => {
		const a = clockAt(new Date("2026-11-30T20:00:00Z"));
		const b = nextClock(a, new Date("2026-12-01T12:00:00Z"));
		expect(b).not.toBe(a);
		expect(b).toMatchObject({ today: "2026-12-01", month: "2026-12" });
	});
	it("muda quando a hora muda (saudação)", () => {
		const a = clockAt(new Date("2026-11-06T14:59:00Z"));
		expect(nextClock(a, new Date("2026-11-06T15:01:00Z")).hour).toBe(12);
	});
});
