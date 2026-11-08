import { describe, expect, it } from "vitest";
import {
	bankRows,
	connectionsUsedLabel,
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

	it("marca o banco quando alguma conexão tem o mesmo logo", () => {
		const rows = bankRows(["Nu Pagamentos S.A.", "Conta Corrente Inter"]);
		expect(rows.filter((r) => r.connected).map((r) => r.name)).toEqual(["Nubank", "Inter"]);
		expect(rows).toHaveLength(8);
	});

	it("conta no máximo 5 conexões no rótulo", () => {
		expect(connectionsUsedLabel(2)).toBe("2 de 5 conexões usadas");
		expect(connectionsUsedLabel(9)).toBe("5 de 5 conexões usadas");
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
