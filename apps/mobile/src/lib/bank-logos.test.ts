import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BANK_LOGO_KEYS, bankLogoKey } from "./bank-logos.ts";

const name = (n: string) => bankLogoKey({ name: n });

describe("bankLogoKey", () => {
	it("o ISPB vence o nome", () => {
		expect(bankLogoKey({ bankCode: "18236120", name: "Minha conta" })).toBe("18236120");
		expect(bankLogoKey({ bankCode: "60701190", name: "Santander" })).toBe("60701190");
	});

	it("empresas do mesmo banco usam o logo dele", () => {
		expect(bankLogoKey({ bankCode: "30680829" })).toBe("18236120");
		expect(bankLogoKey({ bankCode: "60394079" })).toBe("60701190");
	});

	it("ISPB desconhecido cai no nome; sem nome também não tem logo", () => {
		expect(bankLogoKey({ bankCode: "99999999", name: "Nubank" })).toBe("18236120");
		expect(bankLogoKey({ bankCode: "99999999", name: "Banco Qualquer" })).toBeNull();
		expect(bankLogoKey({ bankCode: null })).toBeNull();
		expect(bankLogoKey({ name: "" })).toBeNull();
	});

	it.each([
		["Nubank", "18236120"],
		["NU PAGAMENTOS S.A.", "18236120"],
		["Nubank Ultravioleta Mastercard", "18236120"],
		["Inter", "00416968"],
		["Banco Inter", "00416968"],
		["Mercado Pago", "10573521"],
		["Santander Free Visa", "90400888"],
		["Itaú Unibanco", "60701190"],
		["Itau", "60701190"],
		["Bradesco", "60746948"],
		["Banco do Brasil", "00000000"],
		["BB", "00000000"],
		["Caixa Econômica Federal", "00360305"],
		["Caixa", "00360305"],
		["C6 Bank", "31872495"],
		["BTG Pactual", "30306294"],
		["PicPay", "22896431"],
	])("%s → %s", (n, key) => {
		expect(name(n)).toBe(key);
	});

	it("não confunde palavra que só contém o nome do banco", () => {
		expect(name("Internacional")).toBeNull();
		expect(name("Interior")).toBeNull();
		expect(name("Bbq da firma")).toBeNull();
		expect(name("Nuvem")).toBeNull();
	});

	it("'Caixa' de dinheiro com mais palavras não vira a Caixa Econômica", () => {
		expect(name("Caixa do escritório")).toBeNull();
		expect(name("Caixa pequeno")).toBeNull();
	});

	it("ignora acento e maiúsculas", () => {
		expect(name("ITAÚ")).toBe("60701190");
		expect(name("  picpay  ")).toBe("22896431");
	});
});

describe("assets dos logos", () => {
	const root = new URL("../../assets/banks/", import.meta.url);
	const files = readdirSync(root)
		.filter((f) => f.endsWith(".png"))
		.map((f) => f.replace(".png", ""))
		.sort();

	it("cada chave tem o PNG, e cada PNG tem chave", () => {
		expect(files).toEqual([...BANK_LOGO_KEYS].sort());
	});

	it("cada chave está no mapa de require (o Metro só empacota o que é listado)", () => {
		const map = readFileSync(new URL("../ui/bank-logo-assets.ts", import.meta.url), "utf8");
		for (const key of BANK_LOGO_KEYS)
			expect(map).toContain(`"${key}": require("../../assets/banks/${key}.png")`);
	});
});
