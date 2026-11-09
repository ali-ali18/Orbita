import { describe, expect, it } from "vitest";
import { KNOWN_SUBSCRIPTION_BRANDS, serviceDisplayName, subscriptionBrand } from "./known-services.ts";
import { findMonthlyRuns } from "./subscription-hunt.ts";

describe("variações do mesmo app (DL*GOOGLE X, Google X, direto)", () => {
	const today = "2026-11-09";
	const run = (rows: Array<[string, number, string]>) =>
		findMonthlyRuns({
			charges: rows.map(([date, amountCents, merchant]) => ({
				id: `${date}-${merchant}`,
				date,
				amountCents,
				merchant,
			})),
			today,
			minKnownOccurrences: 2,
			knownBrands: KNOWN_SUBSCRIPTION_BRANDS,
		}).map((r) => [r.brand, r.amountCents, r.charges.length]);

	it("ChatGPT: 'DL*GOOGLE ChatGP', 'Google ChatGPT' e 'DL *GOOGLE *ChatGPT' são o mesmo serviço", () => {
		expect(
			run([
				["2026-09-05", 9599, "DL*GOOGLE ChatGP"],
				["2026-10-05", 9599, "Google ChatGPT"],
				["2026-11-04", 9599, "DL *GOOGLE *ChatGPT"],
			]),
		).toEqual([["chatgpt", 9599, 3]]);
	});

	it("ChatGPT cobrado pelo Google Play num mês e direto pela OpenAI no outro continua um serviço só", () => {
		expect(subscriptionBrand("OPENAI *CHATGPT SUBSCR")).toBe("chatgpt");
		expect(
			run([
				["2026-10-05", 9599, "OPENAI *CHATGPT SUBSCR"],
				["2026-11-04", 9599, "DL*GOOGLE ChatGP"],
			]),
		).toEqual([["chatgpt", 9599, 2]]);
	});

	it("Grok com o nome do banco que for: Grok, SuperGrok, X.AI, xAI LLC (dia 30, duas cobranças)", () => {
		for (const name of ["Grok", "SuperGrok", "X.AI LLC", "xAI LLC SuperGrok"]) {
			expect(subscriptionBrand(name)).toBe("grok");
		}
		expect(
			run([
				["2026-09-30", 16990, "SuperGrok"],
				["2026-10-30", 16990, "X.AI LLC"],
			]),
		).toEqual([["grok", 16990, 2]]);
	});

	it("'Google YouTube Member' (R$ 7,99) é uma sequência à parte do YouTube Premium", () => {
		expect(
			run([
				["2026-09-10", 799, "Google YouTube Member"],
				["2026-10-10", 799, "GOOGLE *YouTube Member"],
				["2026-09-12", 2190, "Google YouTube"],
				["2026-10-12", 2190, "DL*GOOGLE YouTub"],
			]),
		).toEqual([
			["youtube", 799, 2],
			["youtube", 2190, 2],
		]);
	});

	it("'Google Play' com o app dito usa o app; sem app, a marca é a loja", () => {
		expect(subscriptionBrand("GOOGLE PLAY ChatGPT")).toBe("chatgpt");
		expect(subscriptionBrand("GOOGLE PLAY Pierre Control")).toBe("pierre");
		expect(subscriptionBrand("GOOGLE PLAY")).toBe("googleplay");
	});

	it("uma cobrança só na janela não basta (nem para app conhecido)", () => {
		expect(run([["2026-10-30", 16990, "Grok"]])).toEqual([]);
	});
});

describe("serviceDisplayName", () => {
	it.each([
		["GOOGLE BRASIL INTERNET LTDA. DL*GOOGLE ChatGP", "ChatGPT (Google Play)"],
		["Google ChatGPT", "ChatGPT (Google Play)"],
		["OPENAI *CHATGPT SUBSCR", "ChatGPT"],
		["Google Pierre Control", "Pierre"],
		["DL *GOOGLE Pierre Cont", "Pierre"],
		["Google YouTube Member", "YouTube"],
		["DL*GOOGLE YouTub", "YouTube"],
		["DL*GOOGLE Google", "Google One"],
		["Google F1 TV", "F1 TV"],
		["SuperGrok", "Grok"],
		["NETFLIX.COM 12/10", "Netflix"],
	])("%s → %s", (raw, expected) => {
		expect(serviceDisplayName(raw)).toBe(expected);
	});

	it("sem pista do serviço, devolve null (o chamador usa o nome limpo)", () => {
		expect(serviceDisplayName("Padaria do Zé")).toBeNull();
		expect(serviceDisplayName("GOOGLE BRASIL INTERNET LTDA.")).toBeNull();
		expect(serviceDisplayName(null)).toBeNull();
	});
});
