import { describe, expect, it } from "vitest";
import { themeLabel, themeOptions } from "./theme-options.ts";

describe("themeOptions", () => {
	it("lista as sete opções na ordem pedida, com nome em pt-BR", () => {
		expect(themeOptions.map((o) => o.label)).toEqual([
			"Atual",
			"Verde volt",
			"Amarelo",
			"Azul",
			"Fúcsia",
			"Laranja",
			"Violeta",
		]);
		expect(themeOptions.map((o) => o.key)).toEqual([
			"atual",
			"volt",
			"amarelo",
			"azul",
			"fucsia",
			"laranja",
			"violeta",
		]);
	});

	it("themeLabel devolve o nome do tema", () => {
		expect(themeLabel("fucsia")).toBe("Fúcsia");
	});
});
