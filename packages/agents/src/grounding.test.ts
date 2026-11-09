import { describe, expect, it } from "vitest";
import {
	collectAllowedCents,
	findMoneyMentions,
	findUngroundedAmounts,
	redactUngroundedAmounts,
	regenerationRequest,
	UNCONFIRMED_AMOUNT_TEXT,
} from "./grounding.ts";

const TOOL = JSON.stringify({
	totals: {
		registeredPlusSuggestedPerMonth: { cents: 53171, text: "R$ 531,71" },
		suggestedPerMonth: { cents: 123456, text: "R$ 1.234,56" },
	},
	items: [{ amount: { cents: 9599, text: "R$ 95,99" }, dayOfMonth: 30 }],
});

describe("findMoneyMentions", () => {
	it.each([
		["R$ 531,71", 53171],
		["R$531,71", 53171],
		["R$ 1.234,56", 123456],
		["−R$ 46,90", 4690],
		["R$ 1234,56", 123456],
		["R$ 95", 9500],
		["R$ 3,5", 350],
	])("%s → %i centavos", (text, cents) => {
		expect(findMoneyMentions(`valor ${text} fim.`).map((m) => m.cents)).toEqual([cents]);
	});

	it("ignora o que não é um valor pt-BR inequívoco", () => {
		expect(findMoneyMentions("R$ 12.34 e R$ 2 mil e R$ 0,00 e 46,90 sem cifrão")).toEqual([]);
	});

	it("acha vários, na ordem, e tolera ponto final colado", () => {
		expect(findMoneyMentions("De R$ 10,00 para R$ 20,50.").map((m) => m.cents)).toEqual([1000, 2050]);
	});
});

describe("findUngroundedAmounts", () => {
	const allowed = collectAllowedCents([TOOL]);

	it("aceita o que veio da ferramenta, em qualquer formato do mesmo valor", () => {
		expect(findUngroundedAmounts("Total R$ 531,71 e R$ 1.234,56 e R$ 1234,56.", allowed)).toEqual([]);
		expect(findUngroundedAmounts("A conta é R$ 95,99 por mês.", allowed)).toEqual([]);
	});

	it("acusa soma de cabeça e valor inventado", () => {
		const bad = findUngroundedAmounts("O total fica em R$ 532,71 por mês, sendo R$ 95,99 de IA.", allowed);
		expect(bad.map((m) => m.raw)).toEqual(["R$ 532,71"]);
	});

	it("valor sem centavos aceita o arredondamento de um valor que existe, mas não um valor solto", () => {
		expect(findUngroundedAmounts("uns R$ 95 e R$ 96 e R$ 600", allowed).map((m) => m.raw)).toEqual([
			"R$ 600",
		]);
	});

	it("o que o dono disse conta (inclusive número sem vírgula)", () => {
		const user = collectAllowedCents(["tenho 50 e também R$ 1.200,00 guardados"], { integersAsReais: true });
		expect(findUngroundedAmounts("Você falou de R$ 50,00 e R$ 1.200,00.", user)).toEqual([]);
		expect(findUngroundedAmounts("R$ 51,00", user)).toHaveLength(1);
	});

	it("texto sem R$ nunca é acusado", () => {
		expect(findUngroundedAmounts("São 531 por mês, ou 12,5% a mais, dia 30.", allowed)).toEqual([]);
	});
});

describe("redactUngroundedAmounts e regenerationRequest", () => {
	const allowed = collectAllowedCents([TOOL]);

	it("troca só os valores sem origem", () => {
		expect(redactUngroundedAmounts("Total R$ 999,99 de R$ 95,99.", allowed)).toBe(
			`Total ${UNCONFIRMED_AMOUNT_TEXT} de R$ 95,99.`,
		);
		expect(redactUngroundedAmounts("Nada a trocar: R$ 95,99.", allowed)).toBe("Nada a trocar: R$ 95,99.");
	});

	it("o pedido de refazer cita os valores e manda copiar o campo text", () => {
		const bad = findUngroundedAmounts("R$ 999,99 e R$ 888,00", allowed);
		const request = regenerationRequest(bad);
		expect(request).toContain("R$ 999,99");
		expect(request).toContain("R$ 888,00");
		expect(request).toContain("text");
	});
});
