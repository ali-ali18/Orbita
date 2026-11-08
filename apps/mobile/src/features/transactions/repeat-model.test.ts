import { describe, expect, it } from "vitest";
import { buildRepeat, canRepeat, repeatDay, repeatedMessage, repeatStartDate } from "./repeat-model.ts";

const t = {
	kind: "expense" as const,
	installmentGroupId: null,
	amountCents: 4690,
	date: "2026-11-06",
	description: "  iFood  ",
	categoryId: "c-del",
	accountId: null,
	cardId: "card-1",
};

describe("canRepeat", () => {
	it("só despesa e receita avulsas", () => {
		expect(canRepeat(t)).toBe(true);
		expect(canRepeat({ ...t, kind: "income" })).toBe(true);
		expect(canRepeat({ ...t, installmentGroupId: "g" })).toBe(false);
		for (const kind of ["transfer", "card_payment", "refund"] as const) {
			expect(canRepeat({ ...t, kind })).toBe(false);
		}
	});
});

describe("repeatStartDate", () => {
	it("começa no mês seguinte ao do lançamento de hoje", () => {
		expect(repeatStartDate("2026-11-06", "2026-11-06")).toBe("2026-12-01");
	});
	it("lançamento antigo: o mês seguinte ao de hoje", () => {
		expect(repeatStartDate("2026-03-10", "2026-11-06")).toBe("2026-12-01");
	});
	it("lançamento futuro: o mês seguinte ao dele, virando o ano", () => {
		expect(repeatStartDate("2026-12-20", "2026-11-06")).toBe("2027-01-01");
	});
});

describe("buildRepeat", () => {
	it("leva valor, nome, categoria, cartão e dia do lançamento", () => {
		const r = buildRepeat(t, "2026-11-06");
		expect(r).toEqual({
			ok: true,
			plan: {
				body: {
					kind: "expense",
					name: "iFood",
					amountCents: 4690,
					dayOfMonth: 6,
					startDate: "2026-12-01",
					categoryId: "c-del",
					cardId: "card-1",
				},
				dayLabel: "Todo dia 6",
				startLabel: "dezembro",
			},
		});
	});

	it("receita em conta, sem categoria", () => {
		const r = buildRepeat(
			{ ...t, kind: "income", cardId: null, accountId: "acc-1", categoryId: null, date: "2026-11-30" },
			"2026-11-30",
		);
		expect(r.ok && r.plan.body).toEqual({
			kind: "income",
			name: "iFood",
			amountCents: 4690,
			dayOfMonth: 30,
			startDate: "2026-12-01",
			accountId: "acc-1",
		});
	});

	it("nome comprido é cortado em 60 letras", () => {
		const r = buildRepeat({ ...t, description: "x".repeat(150) }, "2026-11-06");
		expect(r.ok && r.plan.body.name).toHaveLength(60);
	});

	it("outro ano aparece no rótulo do início", () => {
		const r = buildRepeat({ ...t, date: "2026-12-06" }, "2026-12-06");
		expect(r.ok && r.plan.startLabel).toBe("janeiro de 2027");
	});

	it("recusa o que não é recorrência", () => {
		expect(buildRepeat({ ...t, kind: "transfer" }, "2026-11-06")).toEqual({
			ok: false,
			message: "Este tipo de lançamento não pode se repetir.",
		});
	});
});

describe("textos", () => {
	it("dia e mensagem", () => {
		expect(repeatDay("2026-11-06")).toBe(6);
		expect(repeatedMessage({ dayLabel: "Todo dia 6", startLabel: "dezembro" })).toBe(
			"Vai repetir todo dia 6, a partir de dezembro.",
		);
	});
});
