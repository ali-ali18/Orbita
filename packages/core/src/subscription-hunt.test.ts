import { describe, expect, it } from "vitest";
import { KNOWN_SUBSCRIPTION_BRANDS, knownServiceOf, subscriptionBrand } from "./known-services.ts";
import {
	detectPriceIncreases,
	detectRecurringCharges,
	findMonthlyRuns,
	type HuntedCharge,
} from "./subscription-hunt.ts";

let n = 0;
const charge = (date: string, amountCents: number, merchant = "Netflix.com"): HuntedCharge => ({
	id: `c${++n}`,
	date,
	amountCents,
	merchant,
});

const monthly = (merchant: string, amounts: number[], start = "2026-08-10") =>
	amounts.map((amount, i) => {
		const [y, m, d] = start.split("-").map(Number) as [number, number, number];
		const month = m + i;
		const date = `${y + Math.floor((month - 1) / 12)}-${String(((month - 1) % 12) + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
		return charge(date, amount, merchant);
	});

describe("detectRecurringCharges", () => {
	const today = "2026-11-12";
	it("acha 3 cobranças mensais parecidas que não são assinatura cadastrada", () => {
		const charges = monthly("NETFLIX.COM", [4490, 4490, 4590]);
		const found = detectRecurringCharges({ charges, registeredNames: [], today });
		expect(found).toEqual([
			{
				merchant: "NETFLIX.COM",
				amountCents: 4490,
				occurrences: 3,
				firstDate: "2026-08-10",
				lastDate: "2026-10-10",
				lastTransactionId: charges[2]?.id,
			},
		]);
	});
	it("duas cobranças não bastam", () => {
		expect(
			detectRecurringCharges({ charges: monthly("Netflix", [4490, 4490]), registeredNames: [], today }),
		).toEqual([]);
	});
	it("já cadastrada (pela marca) ou nascida de recorrência não aparece", () => {
		const charges = monthly("NETFLIX.COM", [4490, 4490, 4490]);
		expect(detectRecurringCharges({ charges, registeredNames: ["Netflix"], today })).toEqual([]);
		expect(
			detectRecurringCharges({
				charges,
				registeredNames: [],
				excludeIds: new Set(charges.map((c) => c.id)),
				today,
			}),
		).toEqual([]);
	});
	it("intervalo que não é mensal ou valor que muda muito quebra o padrão", () => {
		const weekly = [
			charge("2026-10-01", 2000, "Cafe"),
			charge("2026-10-08", 2000, "Cafe"),
			charge("2026-10-15", 2000, "Cafe"),
		];
		expect(detectRecurringCharges({ charges: weekly, registeredNames: [], today })).toEqual([]);
		const jumpy = monthly("Loja X", [1000, 1000, 5000]);
		expect(detectRecurringCharges({ charges: jumpy, registeredNames: [], today })).toEqual([]);
	});
	it("assinatura que já parou há mais de 45 dias não conta", () => {
		const old = monthly("Revista", [2990, 2990, 2990], "2026-05-10");
		expect(detectRecurringCharges({ charges: old, registeredNames: [], today })).toEqual([]);
	});
	it("pega a sequência mais recente e ignora uma cobrança avulsa antiga", () => {
		const charges = [charge("2026-03-02", 8000, "Academia"), ...monthly("Academia", [8900, 8900, 8900])];
		const [found] = detectRecurringCharges({ charges, registeredNames: [], today });
		expect(found).toMatchObject({ occurrences: 3, amountCents: 8900, firstDate: "2026-08-10" });
	});
});

describe("detectPriceIncreases", () => {
	const subs = [
		{ id: "s1", name: "Spotify", amountCents: 2190 },
		{ id: "s2", name: "iCloud", amountCents: 980 },
	];
	it("acha a cobrança mais recente acima do valor cadastrado", () => {
		const charges = [charge("2026-10-05", 2190, "SPOTIFY"), charge("2026-11-05", 3190, "SPOTIFY AB")];
		const found = detectPriceIncreases({ subscriptions: subs, charges, sinceDate: "2026-10-01" });
		expect(found).toEqual([
			{
				subscriptionId: "s1",
				name: "Spotify",
				previousCents: 2190,
				newCents: 3190,
				increaseCents: 1000,
				transactionId: charges[1]?.id,
				date: "2026-11-05",
			},
		]);
	});
	it("ignora aumento de arredondamento, cobrança igual ou menor e cobrança antiga", () => {
		const tiny = [charge("2026-11-05", 2200, "Spotify")];
		expect(detectPriceIncreases({ subscriptions: subs, charges: tiny, sinceDate: "2026-10-01" })).toEqual([]);
		const same = [charge("2026-11-05", 2190, "Spotify"), charge("2026-11-06", 900, "iCloud")];
		expect(detectPriceIncreases({ subscriptions: subs, charges: same, sinceDate: "2026-10-01" })).toEqual([]);
		const old = [charge("2026-08-05", 3190, "Spotify")];
		expect(detectPriceIncreases({ subscriptions: subs, charges: old, sinceDate: "2026-10-01" })).toEqual([]);
	});
	it("o que nasceu da própria recorrência não é aumento", () => {
		const posted = charge("2026-11-05", 3190, "Spotify");
		expect(
			detectPriceIncreases({
				subscriptions: subs,
				charges: [posted],
				sinceDate: "2026-10-01",
				excludeIds: new Set([posted.id]),
			}),
		).toEqual([]);
	});
});

describe("findMonthlyRuns", () => {
	const today = "2026-11-12";
	it("serviço conhecido vale com duas cobranças; desconhecido pede três", () => {
		const netflix = monthly("NETFLIX.COM", [4490, 4490], "2026-09-10");
		const gym = monthly("Academia Foco", [8900, 8900], "2026-09-10");
		const runs = findMonthlyRuns({
			charges: [...netflix, ...gym],
			today,
			minKnownOccurrences: 2,
			knownBrands: KNOWN_SUBSCRIPTION_BRANDS,
		});
		expect(runs.map((r) => r.brand)).toEqual(["netflix"]);
		expect(runs[0]?.charges.map((c) => c.date)).toEqual(["2026-09-10", "2026-10-10"]);
		expect(runs[0]?.amountCents).toBe(4490);
	});
	it("a marca vem de `brandOf` e `skipBrands` tira o que já está cadastrado", () => {
		const charges = monthly("PIX RECEBIDO ACME LTDA", [500000, 500000, 505000], "2026-08-05");
		const runs = findMonthlyRuns({
			charges,
			today,
			brandOf: (m) => m.replace("PIX RECEBIDO ", "").toLowerCase(),
		});
		expect(runs.map((r) => [r.brand, r.charges.length, r.amountCents])).toEqual([["acme ltda", 3, 500000]]);
		expect(findMonthlyRuns({ charges, today, brandOf: () => "acme", skipBrands: new Set(["acme"]) })).toEqual(
			[],
		);
	});
});

describe("serviços conhecidos", () => {
	it("acha o serviço pela marca, sem acento nem código", () => {
		expect(knownServiceOf("NETFLIX.COM 12/10")?.name).toBe("Netflix");
		expect(knownServiceOf("iFood *Pedido")?.categorySlug).toBe("delivery");
		expect(knownServiceOf("Padaria do Zé")).toBeNull();
		expect(knownServiceOf(null)).toBeNull();
	});
	it("só assinatura entra na lista de duas cobranças", () => {
		expect(KNOWN_SUBSCRIPTION_BRANDS.has("netflix")).toBe(true);
		expect(KNOWN_SUBSCRIPTION_BRANDS.has("ifood")).toBe(false);
	});
});

describe("subscriptionBrand", () => {
	it.each([
		["GOOGLE *Google One", "googleone"],
		["Google One", "googleone"],
		["GOOGLE*YOUTUBEMUSIC", "youtube"],
		["DL*GOOGLE YouTube", "youtube"],
		["PAYPAL *GOOGLE", "google"],
		["PG *Spotify", "spotify"],
		["AMAZON PRIME BR", "amazonprime"],
		["Amazon Marketplace", "amazon"],
		["Associação APC", "associacao"],
		// Google Play: a marca é o app vendido (o texto depois de "GOOGLE"), mesmo truncado pelo banco.
		["Google YouTube Member", "youtube"],
		["DL*GOOGLE YouTub", "youtube"],
		["DL*GOOGLE Google", "googleone"],
		["Google dl*GOOGLE Google", "googleone"],
		["DL*GOOGLE ChatGP", "chatgpt"],
		["Google Pierre Control", "pierre"],
		["DL *GOOGLE Pierre Cont", "pierre"],
		["Google F1 TV", "f1"],
		["DL*GOOGLE Grok", "grok"],
		["Google Brasil", "google"],
	])("%s -> %s", (text, brand) => {
		expect(subscriptionBrand(text)).toBe(brand);
	});
});

describe("findMonthlyRuns: marca com mais de um plano", () => {
	const today = "2026-11-12";
	it("duas faixas de valor na mesma marca são duas sequências", () => {
		const charges = [
			...monthly("GOOGLE *Google One", [9690, 9690, 9690], "2026-08-05"),
			...monthly("GOOGLE *Google One", [2190, 2190, 2190], "2026-08-07"),
		];
		const runs = findMonthlyRuns({ charges, today });
		expect(runs.map((r) => [r.brand, r.amountCents, r.charges.length])).toEqual([
			["googleone", 2190, 3],
			["googleone", 9690, 3],
		]);
	});

	it("cobrança duplicada (mesmo valor em 1 dia) conta uma vez e não quebra a sequência", () => {
		const charges = [
			charge("2026-08-05", 9690, "Google One"),
			charge("2026-09-05", 9690, "Google One"),
			charge("2026-09-06", 9690, "Google One"),
			charge("2026-10-05", 9690, "Google One"),
		];
		expect(findMonthlyRuns({ charges, today })[0]?.charges).toHaveLength(3);
	});

	it("intervalos muito irregulares (3 compras que só parecem mensais) não formam padrão", () => {
		const charges = [
			charge("2026-07-01", 5000, "Loja X"),
			charge("2026-07-26", 5000, "Loja X"),
			charge("2026-08-31", 5000, "Loja X"),
		];
		expect(findMonthlyRuns({ charges, today })).toEqual([]);
	});
});

describe("Google Play: cada app é uma assinatura (textos reais do cartão)", () => {
	const today = "2026-11-09";
	const series = (rows: Array<[string, number, string]>) =>
		rows.map(([date, cents, merchant]) => charge(date, cents, merchant));
	const charges = series([
		// Google One: "Google One" e, antes, "DL*GOOGLE Google".
		["2026-10-13", 9699, "Google One"],
		["2026-09-13", 9699, "DL*GOOGLE Google"],
		["2026-08-13", 9699, "DL*GOOGLE Google"],
		// YouTube Premium e YouTube Member (membro de canal): faixas de valor diferentes.
		["2026-10-07", 2690, "Google YouTube"],
		["2026-09-07", 2690, "DL*GOOGLE YouTub"],
		["2026-08-07", 2690, "DL*GOOGLE YouTub"],
		["2026-10-19", 799, "Google YouTube Member"],
		["2026-09-19", 799, "Google YouTube Member"],
		// ChatGPT pelo Google Play, nome cortado.
		["2026-10-14", 9599, "DL*GOOGLE ChatGP"],
		["2026-09-14", 9599, "DL*GOOGLE ChatGP"],
		["2026-08-14", 9599, "DL*GOOGLE ChatGP"],
		// Pierre (cancelado): só duas cobranças.
		["2026-09-30", 3899, "Google Pierre Control"],
		["2026-09-01", 3899, "DL *GOOGLE Pierre Cont"],
		// F1 TV.
		["2026-09-29", 2990, "Google F1 TV"],
		["2026-08-30", 2990, "DL*GOOGLE F1 TV"],
	]);

	it("acha um padrão por app e faixa de valor, sem misturar os apps", () => {
		const runs = findMonthlyRuns({
			charges,
			today,
			minKnownOccurrences: 2,
			knownBrands: KNOWN_SUBSCRIPTION_BRANDS,
		});
		expect(runs.map((r) => [r.brand, r.amountCents, r.charges.length])).toEqual([
			["chatgpt", 9599, 3],
			["f1", 2990, 2],
			["googleone", 9699, 3],
			["pierre", 3899, 2],
			["youtube", 799, 2],
			["youtube", 2690, 3],
		]);
	});

	it("Pierre (app desconhecido) com duas cobranças já é assinatura; outra loja desconhecida não", () => {
		const pierre = charges.filter((c) => c.merchant.toLowerCase().includes("pierre"));
		expect(findMonthlyRuns({ charges: pierre, today, minKnownOccurrences: 2 })).toHaveLength(1);
		const store = series([
			["2026-10-13", 5000, "Loja Zé"],
			["2026-09-13", 5000, "Loja Zé"],
		]);
		expect(findMonthlyRuns({ charges: store, today, minKnownOccurrences: 2 })).toEqual([]);
	});

	it("conhece os serviços pelos textos do banco", () => {
		expect(knownServiceOf("DL*GOOGLE Google")?.name).toBe("Google One (Gemini)");
		expect(knownServiceOf("DL*GOOGLE YouTub")?.name).toBe("YouTube (Premium ou Music)");
		expect(knownServiceOf("DL*GOOGLE ChatGP")?.name).toBe("ChatGPT");
		expect(knownServiceOf("Google F1 TV")?.name).toBe("F1 TV");
	});
});
