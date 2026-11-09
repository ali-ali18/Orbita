import { brandDiscs } from "@orbita/tokens";
import { describe, expect, it } from "vitest";
import { brandGlyphs } from "../ui/brand-glyphs.ts";
import { BRANDS, brandOf } from "./brands.ts";

const idOf = (...texts: string[]) => brandOf(...texts)?.id ?? null;

describe("brandOf", () => {
	it("reconhece o texto como o banco escreve", () => {
		expect(idOf("DL*Spotify P48CE")).toBe("spotify");
		expect(idOf("MLP KABUM-KABUM")).toBe("kabum");
		expect(idOf("Google One")).toBe("googleone");
		expect(idOf("DL*UberRides")).toBe("uber");
		expect(idOf("MERCADOLIVRE*MERCADOLIVRE")).toBe("mercadolivre");
		expect(idOf("CONTA VIVO")).toBe("vivo");
	});

	it("separa serviços do mesmo emissor", () => {
		expect(idOf("DL*GOOGLE YouTub")).toBe("youtube");
		expect(idOf("GOOGLE *Google One")).toBe("googleone");
		expect(idOf("Google Brasil")).toBe("google");
		expect(idOf("AMAZON PRIME BR")).toBe("primevideo");
		expect(idOf("Amazon Marketplace")).toBe("amazon");
		expect(idOf("OPENAI *CHATGPT SUBSCR")).toBe("openai");
		expect(idOf("DL*GOOGLE ChatGP")).toBe("openai");
		expect(idOf("X.AI LLC")).toBe("grok");
	});

	it("acha a marca depois de prefixo de banco e de intermediário", () => {
		expect(idOf("Compra no debito - Pague Menos 123")).toBe("paguemenos");
		expect(idOf("PAYPAL *STEAM")).toBe("steam");
		expect(idOf("MP *CENTAURO")).toBe("centauro");
		expect(idOf("Pix enviado - Magazine Luiza")).toBe("magalu");
		expect(idOf("Drogaria Raia 0123")).toBe("raia");
		expect(idOf("IFOOD *IFOOD")).toBe("ifood");
		expect(idOf("UBER *TRIP")).toBe("uber");
	});

	it("banco vira o logo do banco", () => {
		const nubank = brandOf("Nubank fatura");
		expect(nubank).toMatchObject({ kind: "bank", logo: "18236120" });
		expect(brandOf("Banco Inter")).toMatchObject({ kind: "bank", logo: "00416968" });
		expect(brandOf("TARIFA SANTANDER")).toMatchObject({ kind: "bank", logo: "90400888" });
	});

	it("não confunde palavra parecida", () => {
		expect(idOf("Uberaba Posto")).toBeNull();
		expect(idOf("Internet Fibra")).toBeNull();
		expect(idOf("Caixa de Ferramentas")).toBeNull();
		expect(idOf("Timoneiro Pesca")).toBeNull();
		expect(idOf("Padaria do Zé")).toBeNull();
		expect(idOf("")).toBeNull();
	});

	it("usa o primeiro texto que reconhece", () => {
		expect(idOf("PAG*Loja 12", "Kabum Informatica")).toBe("kabum");
		expect(brandOf(null, undefined)).toBeNull();
	});
});

describe("catálogo", () => {
	const discs = BRANDS.filter((b) => b.kind === "disc");

	it("tem ~40 marcas, sem id repetido", () => {
		expect(BRANDS.length).toBeGreaterThanOrEqual(40);
		expect(new Set(BRANDS.map((b) => b.id)).size).toBe(BRANDS.length);
	});

	it("toda marca de disco tem cores nos tokens e todo token tem marca", () => {
		for (const b of discs) expect(Object.hasOwn(brandDiscs, b.id)).toBe(true);
		expect(Object.keys(brandDiscs).sort()).toEqual(discs.map((b) => b.id).sort());
	});

	it("todo glifo embutido pertence a uma marca de disco", () => {
		const ids = new Set(discs.map((b) => b.id as string));
		for (const id of Object.keys(brandGlyphs)) expect(ids.has(id)).toBe(true);
	});
});
