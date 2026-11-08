import { describe, expect, it } from "vitest";
import { detectPriceIncreases, detectRecurringCharges, type HuntedCharge } from "./subscription-hunt.ts";

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
