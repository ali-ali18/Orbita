import { addDays } from "@orbita/core";
import { createMemoryStores, type Stores } from "@orbita/db";
import { investmentDetailResponse, investmentsOverviewResponse } from "@orbita/shared";
import { describe, expect, it } from "vitest";
import { bankRateOf } from "./investment-terms.ts";
import { investmentDetail, investmentsOverview } from "./investments.ts";

// Tudo fictício. "Hoje" = 2026-11-15 (domingo).
const TODAY = "2026-11-15";
const NOW = new Date("2026-11-15T15:00:00Z");
const clock = { today: TODAY };

async function weekdaysCdi(stores: Stores, start: string, end: string, rateE8: number) {
	const rows = [];
	for (let d = start; d <= end; d = addDays(d, 1)) {
		const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
		if (dow !== 0 && dow !== 6) rows.push({ day: d, rateE8 });
	}
	await stores.cdiRates.upsertMany(rows);
}

async function position(stores: Stores, extra: Record<string, unknown> = {}) {
	return (
		await stores.investments.upsertPosition({
			source: "pluggy",
			externalId: `p${Math.random()}`,
			type: "FIXED_INCOME",
			subtype: "CDB",
			name: "CDB Banco Fictício",
			status: "ACTIVE",
			currency: "BRL",
			balanceCents: 1_010_000,
			...extra,
		})
	).record;
}

const fresh = () => createMemoryStores({ now: () => NOW });

describe("condições e rendimento esperado", () => {
	it("sem nada: diz o que falta, não calcula e não inventa zero; a posição entra na contagem do resumo", async () => {
		const stores = fresh();
		const p = await position(stores);
		const o = await investmentsOverview(stores, clock);
		expect(investmentsOverviewResponse.parse(o)).toEqual(o);
		expect(o.missingTermsPositions).toBe(1);
		expect(o.positions[0]).toMatchObject({
			id: p.id,
			termsApplicable: true,
			terms: { rate: null, invested: null, startDate: null },
			missing: ["rate", "invested", "startDate"],
			nameHint: null,
			expected: null,
			expectedUnavailable: null,
			gapCents: null,
			gapNetCents: null,
		});
	});

	it("o dono informa taxa, valor e data: calcula o esperado e compara com o saldo (origem USER)", async () => {
		const stores = fresh();
		const p = await position(stores, { balanceCents: 1_007_000 });
		await weekdaysCdi(stores, "2026-10-01", "2026-11-13", 50_000);
		await stores.investmentTerms.put(p.id, {
			rateKind: "CDI_PERCENT",
			rateBps: 10_000,
			investedCents: 1_000_000,
			startDate: "2026-11-02",
		});
		const d = await investmentDetail(stores, p.id, clock);
		expect(investmentDetailResponse.parse(d)).toEqual(d);
		const pos = d?.position;
		expect(pos?.terms).toEqual({
			rate: { kind: "CDI_PERCENT", bps: 10_000, source: "USER" },
			invested: { cents: 1_000_000, source: "USER" },
			startDate: { date: "2026-11-02", source: "USER" },
			bank: { rate: null, invested: null, startDate: null },
		});
		expect(pos?.missing).toEqual([]);
		// (1,0005)^10 sobre 10.000,00 = 10.050,11 (referência calculada à parte).
		expect(pos?.expected).toMatchObject({
			grossCents: 1_005_011,
			yieldCents: 5_011,
			asOf: "2026-11-13",
			businessDays: 10,
		});
		expect(pos?.gapCents).toBe(1_007_000 - 1_005_011);
		// 13 dias corridos: IOF 56% de 5.011 = 2.806 e IR 22,5% do resto 2.205 = 496 (495,9) → líquido 1.709.
		expect(pos?.expected?.iofCents).toBe(2_806);
		expect(pos?.expected?.irCents).toBe(496);
		expect(pos?.expected?.netYieldCents).toBe(5_011 - 2_806 - 496);
		expect(pos?.gapNetCents).toBe(1_007_000 - (1_000_000 + 5_011 - 2_806 - 496));
	});

	it("o dono vence o banco (source USER) e o valor do banco vem ao lado em `bank`", async () => {
		const stores = fresh();
		const p = await position(stores, {
			investedCents: 2_000_000,
			purchaseDate: "2026-11-02",
			rate: "110",
			rateType: "CDI",
			balanceCents: 2_011_000,
		});
		await weekdaysCdi(stores, "2026-10-01", "2026-11-13", 50_000);
		await stores.investmentTerms.put(p.id, {
			rateKind: "PREFIXED",
			rateBps: 1_300,
			investedCents: 5_000_000,
			startDate: "2026-10-01",
		});
		const pos = (await investmentDetail(stores, p.id, clock))?.position;
		expect(pos?.terms).toEqual({
			rate: { kind: "PREFIXED", bps: 1_300, source: "USER" },
			invested: { cents: 5_000_000, source: "USER" },
			startDate: { date: "2026-10-01", source: "USER" },
			bank: {
				rate: { kind: "CDI_PERCENT", bps: 11_000 },
				invested: 2_000_000,
				startDate: "2026-11-02",
			},
		});
		// O cálculo usa o que o dono informou (R$ 50.000,00), não o do banco.
		expect(pos?.expected?.grossCents).toBeGreaterThan(5_000_000);
	});

	it("sem o que o dono informou, vale o do banco (source BANK) e `bank` repete o valor", async () => {
		const stores = fresh();
		const p = await position(stores, {
			investedCents: 2_000_000,
			purchaseDate: "2026-11-02",
			rate: "110",
			rateType: "CDI",
			balanceCents: 2_011_000,
		});
		await weekdaysCdi(stores, "2026-10-01", "2026-11-13", 50_000);
		const pos = (await investmentDetail(stores, p.id, clock))?.position;
		expect(pos?.terms).toMatchObject({
			rate: { kind: "CDI_PERCENT", bps: 11_000, source: "BANK" },
			invested: { cents: 2_000_000, source: "BANK" },
			startDate: { date: "2026-11-02", source: "BANK" },
		});
		// 110% do CDI, 10 dias a 0,05%: referência calculada à parte.
		expect(pos?.expected?.grossCents).toBe(2_011_027);
		expect(pos?.gapCents).toBe(2_011_000 - 2_011_027);
	});

	it("issueDate (emissão do papel) NÃO é data de início: só purchaseDate vale como BANK", async () => {
		const stores = fresh();
		const p = await position(stores, {
			investedCents: 1_000_000,
			issueDate: "2026-01-10",
			rate: "100",
			rateType: "CDI",
		});
		const pos = (await investmentDetail(stores, p.id, clock))?.position;
		expect(pos?.terms?.startDate).toBeNull();
		expect(pos?.terms?.bank?.startDate).toBeNull();
		expect(pos?.missing).toEqual(["startDate"]);
		expect(pos?.expected).toBeNull();
	});

	it("sugestão pelo nome aparece mas NUNCA entra no cálculo", async () => {
		const stores = fresh();
		const p = await position(stores, {
			name: "CDB 102% do CDI",
			investedCents: 1_000_000,
			purchaseDate: "2026-11-02",
		});
		await weekdaysCdi(stores, "2026-10-01", "2026-11-13", 50_000);
		const pos = (await investmentDetail(stores, p.id, clock))?.position;
		expect(pos?.nameHint).toEqual({
			kind: "CDI_PERCENT",
			bps: 10_200,
			matched: "102% do CDI",
			source: "NAME_HINT",
		});
		expect(pos?.missing).toEqual(["rate"]);
		expect(pos?.expected).toBeNull();
		// Confirmando (o app manda a taxa pelo PUT), passa a valer e a sugestão some.
		await stores.investmentTerms.put(p.id, { rateKind: "CDI_PERCENT", rateBps: 10_200 });
		const after = (await investmentDetail(stores, p.id, clock))?.position;
		expect(after?.nameHint).toBeNull();
		expect(after?.terms?.rate).toEqual({ kind: "CDI_PERCENT", bps: 10_200, source: "USER" });
		expect(after?.expected).not.toBeNull();
	});

	it("IPCA+ guarda a taxa mas devolve esperado null com o motivo; série ausente também", async () => {
		const stores = fresh();
		const p = await position(stores);
		await stores.investmentTerms.put(p.id, {
			rateKind: "IPCA_PLUS",
			rateBps: 620,
			investedCents: 1_000_000,
			startDate: "2026-11-02",
		});
		let pos = (await investmentDetail(stores, p.id, clock))?.position;
		expect(pos?.expected).toBeNull();
		expect(pos?.expectedUnavailable).toMatchObject({ code: "ipca_unsupported" });
		expect(pos?.terms?.rate).toMatchObject({ kind: "IPCA_PLUS", bps: 620 });
		await stores.investmentTerms.put(p.id, {
			rateKind: "CDI_PERCENT",
			rateBps: 10_000,
			investedCents: 1_000_000,
			startDate: "2026-11-02",
		});
		pos = (await investmentDetail(stores, p.id, clock))?.position;
		expect(pos?.expected).toBeNull();
		expect(pos?.expectedUnavailable).toMatchObject({ code: "cdi_unavailable" });
		expect(pos?.gapCents).toBeNull();
	});

	it("renda variável, fundo e posição encerrada não têm taxa nem esperado", async () => {
		const stores = fresh();
		const acao = await position(stores, { type: "EQUITY", subtype: "STOCK", name: "EXEM3" });
		const velho = await position(stores, { status: "TOTAL_WITHDRAWAL", balanceCents: 0 });
		const o = await investmentsOverview(stores, clock);
		expect(o.missingTermsPositions).toBe(0);
		expect(o.positions.find((x) => x.id === acao.id)).toMatchObject({
			termsApplicable: false,
			missing: [],
			expected: null,
		});
		const d = await investmentDetail(stores, velho.id, clock);
		expect(d?.position).toMatchObject({ termsApplicable: false, expected: null });
	});

	it("tipo desconhecido: bruto existe, líquido null com motivo", async () => {
		const stores = fresh();
		const p = await position(stores, { subtype: null, name: "Papel de renda fixa" });
		await weekdaysCdi(stores, "2026-10-01", "2026-11-13", 50_000);
		await stores.investmentTerms.put(p.id, {
			rateKind: "CDI_PERCENT",
			rateBps: 10_000,
			investedCents: 1_000_000,
			startDate: "2026-10-01",
		});
		const e = (await investmentDetail(stores, p.id, clock))?.position.expected;
		expect(e?.grossCents).toBeGreaterThan(1_000_000);
		expect(e?.netYieldCents).toBeNull();
		expect(e?.reason).toContain("desconhecido");
	});
});

describe("bankRateOf: só o formato inequívoco", () => {
	it.each([
		[
			{ rate: "110", rateType: "CDI", fixedAnnualRate: null },
			{ kind: "CDI_PERCENT", bps: 11_000 },
		],
		[
			{ rate: "102.5", rateType: "CDI", fixedAnnualRate: null },
			{ kind: "CDI_PERCENT", bps: 10_250 },
		],
		[
			{ rate: null, rateType: "IPCA", fixedAnnualRate: "6.2" },
			{ kind: "IPCA_PLUS", bps: 620 },
		],
		[
			{ rate: null, rateType: "PREFIXADO", fixedAnnualRate: "13.5" },
			{ kind: "PREFIXED", bps: 1_350 },
		],
		[
			{ rate: null, rateType: "PRE", fixedAnnualRate: "13.5" },
			{ kind: "PREFIXED", bps: 1_350 },
		],
		// CDI junto com taxa fixa é CDI + spread: descarta; sem indexador explícito não adivinha prefixado.
		[{ rate: "100", rateType: "CDI", fixedAnnualRate: "2" }, null],
		[{ rate: null, rateType: "CDI", fixedAnnualRate: "2" }, null],
		[{ rate: null, rateType: null, fixedAnnualRate: "13.5" }, null],
		[{ rate: null, rateType: "", fixedAnnualRate: "13.5" }, null],
		// Não casa: spread sobre o CDI, taxa absurda, mais de 2 casas, indexador desconhecido.
		[{ rate: "2", rateType: "CDI", fixedAnnualRate: null }, null],
		[{ rate: "1100", rateType: "CDI", fixedAnnualRate: null }, null],
		[{ rate: "110.123", rateType: "CDI", fixedAnnualRate: null }, null],
		[{ rate: null, rateType: "SELIC", fixedAnnualRate: "13" }, null],
		[{ rate: null, rateType: null, fixedAnnualRate: "150" }, null],
		[{ rate: null, rateType: null, fixedAnnualRate: null }, null],
	])("%j", (input, expected) => {
		expect(bankRateOf(input)).toEqual(expected);
	});
});
