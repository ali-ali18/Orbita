import { describe, expect, it } from "vitest";
import {
	aiCostCaption,
	aiCostLabel,
	fastModelChoices,
	limitFieldValue,
	limitValueLabel,
	mainModelChoices,
	modelLabel,
	modelPriceLabel,
	parseUsdInput,
} from "./ai-model.ts";

const sonnet = {
	id: "claude-sonnet-5-5",
	label: "Sonnet 5.5",
	description: "Equilibrado.",
	main: true,
	fast: false,
	inputMicroUsdPerMTok: 2_000_000,
	outputMicroUsdPerMTok: 10_000_000,
	priceToConfirm: false,
};

const haiku = {
	id: "claude-haiku-5-5",
	label: "Haiku 5.5",
	description: "Rápido.",
	main: true,
	fast: true,
	inputMicroUsdPerMTok: 100_000,
	outputMicroUsdPerMTok: 500_000,
	priceToConfirm: true,
};

const options = [sonnet, haiku];

const settings = {
	chatModel: "claude-sonnet-5-5",
	chatModelFast: "claude-haiku-5-5" as string | null,
	chatModelCustom: false,
	chatModelFastCustom: false,
	modelOptions: options,
	month: "2026-11",
	costMicroUsd: 123_456,
	requests: 3,
	inputTokens: 10,
	outputTokens: 5,
	limitUsdCents: 1000,
	blocked: false,
	keyConfigured: true,
};

describe("limite digitado em dólares", () => {
	it("lê inteiros e centavos com vírgula ou ponto, com ou sem US$", () => {
		const cents = (text: string) => {
			const r = parseUsdInput(text);
			return r.ok ? r.cents : null;
		};
		expect(cents("10")).toBe(1000);
		expect(cents("10,5")).toBe(1050);
		expect(cents("12,50")).toBe(1250);
		expect(cents("US$ 7.25")).toBe(725);
		expect(cents("0")).toBe(0);
		expect(cents(" 3 ")).toBe(300);
		expect(cents("10000")).toBe(1_000_000);
	});

	it("recusa lixo, negativo, milhar ambíguo e acima do teto, sem mexer em dinheiro", () => {
		for (const bad of ["", "abc", "-5", "1.000", "10,555", "1,2,3", "R$ 10", "10000,01", "100000"]) {
			expect(parseUsdInput(bad).ok, bad).toBe(false);
		}
		expect(parseUsdInput("abc")).toEqual({
			ok: false,
			message: "Digite o limite em dólares, por exemplo 10 ou 12,50.",
		});
		expect(parseUsdInput("10000,01")).toEqual({ ok: false, message: "O limite passa de US$ 10.000." });
	});

	it("o campo abre com o valor atual e o rótulo diz sem limite quando é null", () => {
		expect(limitFieldValue(1000)).toBe("10,00");
		expect(limitFieldValue(null)).toBe("");
		expect(limitValueLabel(1250)).toBe("US$ 12,50");
		expect(limitValueLabel(null)).toBe("Sem limite");
	});
});

describe("custo do mês", () => {
	it("mostra o gasto em dólar arredondado para cima", () => {
		expect(aiCostLabel(settings)).toBe("US$ 0,13");
		expect(aiCostLabel({ costMicroUsd: 0 })).toBe("US$ 0,00");
		expect(aiCostLabel({ costMicroUsd: 1 })).toBe("US$ 0,01");
		expect(aiCostLabel({ costMicroUsd: 12_340_000 })).toBe("US$ 12,34");
	});

	it("legenda conta as chamadas e avisa quando o chat está pausado", () => {
		expect(aiCostCaption(settings)).toBe("3 chamadas");
		expect(aiCostCaption({ ...settings, requests: 1 })).toBe("1 chamada");
		expect(aiCostCaption({ ...settings, blocked: true })).toBe(
			"Limite atingido: o chat está pausado · 3 chamadas",
		);
	});
});

describe("modelo do chat", () => {
	it("mostra o nome do modelo e cai no id quando ele não está na lista; null é desligado", () => {
		expect(modelLabel(options, "claude-haiku-5-5")).toBe("Haiku 5.5");
		expect(modelLabel(options, "claude-novo")).toBe("claude-novo");
		expect(modelLabel(options, null)).toBe("Desligado");
	});

	it("o preço sai do servidor em dólar por milhão de tokens, com aviso se não conferido", () => {
		expect(modelPriceLabel(sonnet)).toBe("US$ 2,00 entrada · US$ 10,00 saída por 1 mi de tokens");
		expect(modelPriceLabel(haiku)).toBe(
			"US$ 0,10 entrada · US$ 0,50 saída por 1 mi de tokens (preço a conferir)",
		);
	});

	it("o modelo rápido oferece só os rápidos e Desligado; o principal, todos os principais", () => {
		expect(mainModelChoices(options).map((c) => c.id)).toEqual(["claude-sonnet-5-5", "claude-haiku-5-5"]);
		expect(fastModelChoices(options).map((c) => c.id)).toEqual(["claude-haiku-5-5", "off"]);
		expect(fastModelChoices(options).at(-1)?.price).toBeNull();
	});
});
