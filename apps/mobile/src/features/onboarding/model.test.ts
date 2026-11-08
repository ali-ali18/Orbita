import { describe, expect, it } from "vitest";
import {
	connectionsUsedLabel,
	meuPluggyRow,
	progressLabel,
	SUGGESTED_TOTAL_CENTS,
	splitBudget,
	stepBudget,
} from "./model.ts";

describe("primeira vez", () => {
	it("progresso de 1 a 4", () => {
		expect(progressLabel(1)).toBe("1 de 4");
		expect(progressLabel(4)).toBe("4 de 4");
	});

	it("a primeira vez tem uma conexão: o Meu Pluggy", () => {
		expect(meuPluggyRow(0)).toEqual({ name: "Meu Pluggy", connected: false });
		expect(meuPluggyRow(1)).toEqual({ name: "Meu Pluggy", connected: true });
		expect(meuPluggyRow(3).connected).toBe(true);
	});

	it("o rótulo conta essa única conexão", () => {
		expect(connectionsUsedLabel(false)).toBe("0 de 1 conexão");
		expect(connectionsUsedLabel(true)).toBe("1 de 1 conexão");
	});

	it("sobe e desce o orçamento de 100 em 100, dentro do intervalo", () => {
		expect(stepBudget(300_000, 1)).toBe(310_000);
		expect(stepBudget(300_000, -1)).toBe(290_000);
		expect(stepBudget(100_000, -1)).toBe(100_000);
		expect(stepBudget(5_000_000, 1)).toBe(5_000_000);
	});

	it("a divisão soma o total e começa nos valores do Figma", () => {
		const rows = splitBudget(SUGGESTED_TOTAL_CENTS);
		expect(rows.map((r) => r.cents)).toEqual([90_000, 50_000, 40_000, 25_000, 40_000, 55_000]);
		const scaled = splitBudget(600_000);
		expect(scaled.reduce((s, r) => s + r.cents, 0)).toBe(600_000);
	});
});
