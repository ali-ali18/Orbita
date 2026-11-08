import { describe, expect, it } from "vitest";
import {
	connectionsUsedLabel,
	onboardingBankRows,
	onboardingPhase,
	progressLabel,
	SUGGESTED_TOTAL_CENTS,
	showsAutomaticSetup,
	showsSetupInSettings,
	splitBudget,
	stepBudget,
} from "./model.ts";

describe("primeira vez", () => {
	it("progresso de 1 a 4", () => {
		expect(progressLabel(1)).toBe("1 de 4");
		expect(progressLabel(4)).toBe("4 de 4");
	});

	it("quem entra agora faz os passos; quem já entrou só vê nas configurações; feito, some", () => {
		expect(onboardingPhase(null)).toBe("available");
		expect(onboardingPhase("pending")).toBe("pending");
		expect(onboardingPhase("done")).toBe("done");
		expect(onboardingPhase("outro")).toBe("available");
		expect(showsAutomaticSetup("pending")).toBe(true);
		expect(showsAutomaticSetup("available")).toBe(false);
		expect(showsAutomaticSetup("done")).toBe(false);
		expect(showsSetupInSettings("available")).toBe(true);
		expect(showsSetupInSettings("pending")).toBe(false);
		expect(showsSetupInSettings("done")).toBe(false);
	});

	it("lista os bancos e deixa o Meu Pluggy por último", () => {
		const rows = onboardingBankRows([]);
		expect(rows.map((row) => row.name)).toEqual([
			"Nubank",
			"Inter",
			"Santander",
			"Mercado Pago",
			"Itaú",
			"C6 Bank",
			"PicPay",
			"Bradesco",
			"Meu Pluggy",
		]);
		expect(rows.every((row) => row.logo.length > 0)).toBe(true);
		expect(rows.slice(0, -1).every((row) => !row.connectable && !row.connected)).toBe(true);
		expect(rows.at(-1)).toMatchObject({
			name: "Meu Pluggy",
			logo: "meu-pluggy",
			connected: false,
			connectable: true,
		});
	});

	it("marca o banco pelo nome da conexão e o Meu Pluggy quando há conexão", () => {
		const rows = onboardingBankRows(["Nubank", null]);
		expect(rows.find((row) => row.name === "Nubank")?.connected).toBe(true);
		expect(rows.find((row) => row.name === "Santander")?.connected).toBe(false);
		expect(rows.at(-1)?.connected).toBe(true);
		expect(onboardingBankRows(["Meu Pluggy"]).find((row) => row.name === "Inter")?.connected).toBe(false);
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
