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

	it("reconhece a marca com o contexto que a distingue da palavra comum", () => {
		expect(idOf("AMAZON.COM.BR")).toBe("amazon");
		expect(idOf("AmazonMktplc*Loja")).toBe("amazon");
		expect(idOf("AMZN Mktp BR")).toBe("amazon");
		expect(idOf("CLAUDE.AI SUBSCRIPTION")).toBe("claude");
		expect(idOf("CLARO S.A.")).toBe("claro");
		expect(idOf("Claro TV")).toBe("claro");
		expect(idOf("TIM S.A.")).toBe("tim");
		expect(idOf("TIM CELULAR")).toBe("tim");
		expect(idOf("PG *99APP")).toBe("99");
		expect(idOf("99 Pop")).toBe("99");
		expect(idOf("ITAU UNIBANCO")).toBe("itau");
		expect(idOf("Banco Itau")).toBe("itau");
		expect(idOf("BANCO INTER")).toBe("inter");
		expect(idOf("INTER&CO")).toBe("inter");
		expect(idOf("VIVO FIBRA")).toBe("vivo");
		expect(idOf("TELEFONICA BRASIL")).toBe("vivo");
		expect(idOf("DISNEY+")).toBe("disneyplus");
		expect(idOf("Disney Plus")).toBe("disneyplus");
		expect(idOf("Google Gemini")).toBe("googleone");
		expect(idOf("AmazonMktplace*Loja")).toBe("amazon");
		expect(idOf("AMAZON PRIME VIDEO")).toBe("primevideo");
		expect(idOf("PRIMEVIDEO BR")).toBe("primevideo");
		expect(idOf("X.AI")).toBe("grok");
		expect(idOf("XAI CORP")).toBe("grok");
		expect(idOf("Disney Brasil")).toBe("disneyplus");
		// "xai" só como token isolado: palavra comum que começa com xai não casa.
		expect(idOf("Xaiane Cabeleireira")).toBeNull();
		expect(idOf("Pix enviado - Xai Silva")).toBeNull();
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
		for (const text of [
			"AMAZONAS ENERGIA",
			"Drogaria Amazonas",
			"Pix enviado - Claudete Souza",
			"CLAUDEMIR LANCHES",
			"Posto Rio Claro",
			"Auto Posto Itauna",
			"LOJA 1,99",
			"Mercadinho 99",
			"Restaurante Inter",
			"Inter Shopping",
			"Gemini Pizzaria",
			"Oficina Disney",
			"Posto Vivo",
			"Pix enviado - Tim Souza",
			// Sobrenome ou nome de lugar que coincide com a marca: com outra palavra no nome, é outro estabelecimento.
			"PIX ENVIADO Tim Sa",
			"Tim Sá Restaurante",
			"Raia Restaurante",
			"Auto Posto Itau",
			"Cabine Telefonica",
			"Uber Lanches",
			"Apple Lanches",
			"Steamhouse Burger",
		]) {
			expect(idOf(text), text).toBeNull();
		}
		expect(idOf("")).toBeNull();
		// O nome inteiro continua valendo.
		expect(idOf("UBER")).toBe("uber");
		expect(idOf("Apple")).toBe("apple");
		expect(idOf("RAIA")).toBe("raia");
		expect(idOf("ITAU")).toBe("itau");
		expect(idOf("TIM SA")).toBe("tim");
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
