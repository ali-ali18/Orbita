import { SECRET_NAMES } from "@orbita/shared";
import { describe, expect, it } from "vitest";
import {
	formatPairedSince,
	formatResponseTime,
	formatShortDate,
	pasteHint,
	secretCaption,
	secretState,
	secretStateLabel,
	serverStatusLine,
	timed,
	yearOf,
} from "./settings-model.ts";

// 15h UTC (meio-dia em Brasília): cai no mesmo dia de calendário em qualquer fuso do Brasil.
const NOV7 = "2026-11-07T15:00:00.000Z";

describe("estado da chave", () => {
	it("configurada e legível", () => {
		expect(secretState({ configured: true, readable: true })).toBe("configured");
		expect(secretStateLabel({ configured: true, readable: true })).toBe("Configurada");
	});
	it("não configurada", () => {
		expect(secretStateLabel({ configured: false, readable: false })).toBe("Não configurada");
	});
	it("configurada mas ilegível pede para colar de novo", () => {
		expect(secretStateLabel({ configured: true, readable: false })).toBe("Cole de novo");
	});
});

describe("datas", () => {
	it("ano do dia de hoje", () => {
		expect(yearOf("2026-11-07")).toBe(2026);
	});
	it("dia e mês curtos em pt-BR", () => {
		expect(formatShortDate(NOV7, 2026)).toBe("7 nov");
	});
	it("inclui o ano quando não é o atual", () => {
		expect(formatShortDate(NOV7, 2027)).toBe("7 nov 2026");
	});
	it("data inválida vira null", () => {
		expect(formatShortDate("ontem", 2026)).toBeNull();
	});
	it("conectado desde", () => {
		expect(formatPairedSince(NOV7, 2026)).toBe("7 de nov");
		expect(formatPairedSince("x", 2026)).toBe("—");
	});
});

describe("linha secundária da chave", () => {
	it("mostra data e aparelho", () => {
		expect(secretCaption({ configured: true, updatedAt: NOV7, updatedBy: "Galaxy" }, 2026)).toBe(
			"Trocada em 7 nov por Galaxy",
		);
	});
	it("sem aparelho, só a data", () => {
		expect(secretCaption({ configured: true, updatedAt: NOV7, updatedBy: null }, 2026)).toBe(
			"Trocada em 7 nov",
		);
	});
	it("não configurada não tem linha", () => {
		expect(secretCaption({ configured: false, updatedAt: null, updatedBy: null }, 2026)).toBeNull();
	});
});

describe("tempo de resposta", () => {
	it("arredonda e nunca fica negativo", () => {
		expect(formatResponseTime(41.6)).toBe("42 ms");
		expect(formatResponseTime(-3)).toBe("0 ms");
	});
	it("linha de status", () => {
		expect(serverStatusLine("0.1.0", 42)).toBe("Versão 0.1.0 · resposta em 42 ms");
	});
	it("mede com o relógio injetado", async () => {
		const ticks = [100, 142];
		const { result, ms } = await timed(
			async () => "ok",
			() => ticks.shift() ?? 0,
		);
		expect(result).toBe("ok");
		expect(ms).toBe(42);
	});
	it("propaga a falha da chamada", async () => {
		await expect(
			timed(
				async () => {
					throw new Error("fora");
				},
				() => 0,
			),
		).rejects.toThrow("fora");
	});
});

describe("nada do valor aparece", () => {
	const SECRET = "sk-ant-teste-1234567890abcdef";
	it("nenhum texto de exibição contém o valor nem seus últimos caracteres", () => {
		const status = { configured: true, readable: true, updatedAt: NOV7, updatedBy: "Galaxy" };
		const shown = [
			secretStateLabel(status),
			secretCaption(status, 2026) ?? "",
			...SECRET_NAMES.map(pasteHint),
		].join(" ");
		expect(shown).not.toContain(SECRET);
		expect(shown).not.toContain(SECRET.slice(-4));
		expect(shown).not.toMatch(/•|\*{2,}/);
	});
});
