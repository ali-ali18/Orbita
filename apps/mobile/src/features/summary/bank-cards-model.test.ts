import { describe, expect, it } from "vitest";
import {
	accountsCountLabel,
	formatPercent,
	freshnessLabel,
	limitSourceLabel,
	timesLabel,
	variation,
} from "./bank-cards-model.ts";

const now = new Date("2026-11-08T15:00:00Z");

describe("bank-cards-model", () => {
	it("idade da leitura: agora, minutos, horas, nunca lido", () => {
		expect(freshnessLabel("2026-11-08T14:59:50Z", now)).toBe("atualizado agora");
		expect(freshnessLabel("2026-11-08T14:55:00Z", now)).toBe("atualizado há 5 min");
		expect(freshnessLabel("2026-11-08T12:00:00Z", now)).toBe("atualizado há 3 h");
		expect(freshnessLabel(null, now)).toBeNull();
		expect(freshnessLabel("lixo", now)).toBeNull();
	});

	it("plurais", () => {
		expect(accountsCountLabel(1)).toBe("1 conta");
		expect(accountsCountLabel(4)).toBe("4 contas");
		expect(timesLabel(1)).toBe("1 vez");
		expect(timesLabel(3)).toBe("3 vezes");
	});

	it("percentual com vírgula e sem ,0", () => {
		expect(formatPercent(12.5)).toBe("12,5%");
		expect(formatPercent(-8)).toBe("8%");
		expect(formatPercent(0.04)).toBe("0%");
	});

	it("variação: menos gasto é seta para baixo; sem base não inventa número", () => {
		expect(variation(-12.5).text).toBe("↓ 12,5% vs mês anterior");
		expect(variation(30).text).toBe("↑ 30% vs mês anterior");
		expect(variation(30).spoken).toContain("a mais");
		expect(variation(0).arrow).toBe("=");
		expect(variation(null).text).toBe("Sem mês anterior para comparar");
	});

	it("limite: origem do usado", () => {
		expect(limitSourceLabel("estimated")).toBe("Estimado pelo Órbita");
	});
});
