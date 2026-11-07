import { describe, expect, it } from "vitest";
import { categoryForCnae, categoryForMcc } from "./mcc.ts";

describe("categoryForMcc", () => {
	it.each([
		[5411, "mercado"],
		[5499, "mercado"],
		[5812, "delivery"],
		[5814, "delivery"],
		[4121, "transporte"],
		[4111, "transporte"],
		[5541, "transporte"],
		[5542, "transporte"],
		[4899, "assinaturas"],
		[5815, "assinaturas"],
		[5818, "assinaturas"],
		[7832, "lazer"],
		[7996, "lazer"],
		[3015, "lazer"], // faixa de companhias aéreas
		[3700, "lazer"], // faixa de hotéis
		[5912, "saude"],
		[8011, "saude"],
		[8062, "saude"],
		[6513, "moradia"],
		[4900, "moradia"],
	])("%d → %s", (mcc, slug) => {
		expect(categoryForMcc(mcc)).toBe(slug);
	});

	it("aceita texto e recusa o que não é código útil", () => {
		expect(categoryForMcc("5411")).toBe("mercado");
		expect(categoryForMcc(" 5812 ")).toBe("delivery");
		for (const bad of [0, -1, 5311, 9999, 12.5, "abc", "", null, undefined, "54110"]) {
			expect(categoryForMcc(bad as never)).toBeNull();
		}
	});
});

describe("categoryForCnae", () => {
	it("usa a classe (4 primeiros dígitos) em qualquer formato", () => {
		expect(categoryForCnae("4711-3/02")).toBe("mercado");
		expect(categoryForCnae("4711302")).toBe("mercado");
		expect(categoryForCnae("5611201")).toBe("delivery");
		expect(categoryForCnae("4771701")).toBe("saude");
		expect(categoryForCnae("4731800")).toBe("transporte");
		expect(categoryForCnae("5510801")).toBe("lazer");
	});
	it("desconhecido ou curto demais vira null", () => {
		expect(categoryForCnae("9999999")).toBeNull();
		expect(categoryForCnae("47")).toBeNull();
		expect(categoryForCnae(null)).toBeNull();
	});
});
