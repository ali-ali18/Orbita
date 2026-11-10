import {
	CDI_DAILY_MAX_E8,
	INVESTMENT_RATE_KINDS,
	MIN_APPLICATION_DATE,
	RATE_LIMITS_BPS,
	TERM_SOURCES,
} from "@orbita/core";
import {
	INVESTMENT_RATE_KINDS as SHARED_KINDS,
	RATE_LIMITS_BPS as SHARED_LIMITS,
	MIN_APPLICATION_DATE as SHARED_MIN_DATE,
	TERM_SOURCES as SHARED_SOURCES,
} from "@orbita/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { contractSuites } from "./contract-harness.ts";
import type { Stores } from "./stores.ts";

// Tudo fictício. Os mesmos casos rodam na memória e no Postgres.

describe("listas e limites repetidos em core e shared", () => {
	it("são iguais (o schema da API não pode divergir do engine e do banco)", () => {
		expect([...SHARED_KINDS]).toEqual([...INVESTMENT_RATE_KINDS]);
		expect([...SHARED_SOURCES]).toEqual([...TERM_SOURCES]);
		expect(SHARED_LIMITS).toEqual(RATE_LIMITS_BPS);
		expect(SHARED_MIN_DATE).toBe(MIN_APPLICATION_DATE);
	});
});

describe.each(contractSuites())("InvestmentTermsStore (%s)", (_name, make) => {
	let stores: Stores;
	let id: string;
	beforeEach(async () => {
		stores = await make();
		id = (await stores.investments.upsertPosition({ source: "pluggy", externalId: "p1", name: "CDB X" }))
			.record.id;
	});

	it("sem condições informadas: get e list vazios (ausente nunca vira zero)", async () => {
		expect(await stores.investmentTerms.get(id)).toBeNull();
		expect(await stores.investmentTerms.list()).toEqual([]);
	});

	it("grava taxa, valor e data com a origem USER; ausente fica null", async () => {
		const rec = await stores.investmentTerms.put(id, {
			rateKind: "CDI_PERCENT",
			rateBps: 10_200,
			startDate: "2026-03-10",
		});
		expect(rec).toMatchObject({
			investmentId: id,
			rateKind: "CDI_PERCENT",
			rateBps: 10_200,
			rateSource: "USER",
			investedCents: null,
			investedSource: null,
			startDate: "2026-03-10",
			startDateSource: "USER",
		});
		expect(await stores.investmentTerms.get(id)).toEqual(rec);
		expect(await stores.investmentTerms.list()).toEqual([rec]);
	});

	it("PUT substitui: o que não vem some; tudo vazio apaga a linha", async () => {
		const first = await stores.investmentTerms.put(id, {
			rateKind: "PREFIXED",
			rateBps: 1_350,
			investedCents: 500_000,
			startDate: "2026-01-02",
		});
		const second = await stores.investmentTerms.put(id, { investedCents: 700_000 });
		expect(second).toMatchObject({ rateKind: null, rateBps: null, rateSource: null, investedCents: 700_000 });
		expect(second?.startDate).toBeNull();
		expect(second?.createdAt.getTime()).toBe(first?.createdAt.getTime());
		expect(second?.updatedAt.getTime()).toBeGreaterThan(first?.updatedAt.getTime() as number);
		expect(await stores.investmentTerms.put(id, {})).toBeNull();
		expect(await stores.investmentTerms.get(id)).toBeNull();
		expect(await stores.investmentTerms.put(id, { rateKind: null, rateBps: null })).toBeNull();
	});

	it("guarda a origem informada (NAME_HINT, BANK)", async () => {
		const rec = await stores.investmentTerms.put(id, {
			rateKind: "IPCA_PLUS",
			rateBps: 620,
			source: "NAME_HINT",
		});
		expect(rec).toMatchObject({ rateKind: "IPCA_PLUS", rateBps: 620, rateSource: "NAME_HINT" });
	});

	it("posição inexistente: nao encontrado", async () => {
		await expect(stores.investmentTerms.put("nada", { investedCents: 1 })).rejects.toMatchObject({
			code: "not_found",
		});
	});

	it("o sync que regrava a posição não apaga as condições do dono", async () => {
		await stores.investmentTerms.put(id, { rateKind: "CDI_PERCENT", rateBps: 10_000 });
		await stores.investments.upsertPosition({ source: "pluggy", externalId: "p1", balanceCents: 123 });
		expect((await stores.investmentTerms.get(id))?.rateBps).toBe(10_000);
	});

	it.each([
		["tipo sem taxa", { rateKind: "CDI_PERCENT" as const }],
		["taxa sem tipo", { rateBps: 10_000 }],
		["% do CDI acima de 1000%", { rateKind: "CDI_PERCENT" as const, rateBps: 100_001 }],
		["% do CDI zero", { rateKind: "CDI_PERCENT" as const, rateBps: 0 }],
		["prefixado acima de 100% a.a.", { rateKind: "PREFIXED" as const, rateBps: 10_001 }],
		["IPCA+ negativo", { rateKind: "IPCA_PLUS" as const, rateBps: -1 }],
		["taxa decimal", { rateKind: "PREFIXED" as const, rateBps: 13.5 }],
		["tipo desconhecido", { rateKind: "SELIC" as never, rateBps: 100 }],
		["valor zero", { investedCents: 0 }],
		["valor negativo", { investedCents: -5 }],
		["valor decimal", { investedCents: 10.5 }],
		["valor acima do limite", { investedCents: 2_147_483_648 }],
		["data inexistente", { startDate: "2026-02-30" }],
		["data antiga demais", { startDate: "1980-01-01" }],
		["origem inválida", { investedCents: 1, source: "ROBO" as never }],
	])("recusa: %s", async (_label, input) => {
		await expect(stores.investmentTerms.put(id, input)).rejects.toMatchObject({ code: "invalid" });
		expect(await stores.investmentTerms.get(id)).toBeNull();
	});

	it("aceita os limites exatos", async () => {
		expect(
			await stores.investmentTerms.put(id, { rateKind: "CDI_PERCENT", rateBps: 100_000 }),
		).not.toBeNull();
		expect(await stores.investmentTerms.put(id, { rateKind: "PREFIXED", rateBps: 10_000 })).not.toBeNull();
		expect(await stores.investmentTerms.put(id, { rateKind: "IPCA_PLUS", rateBps: 0 })).not.toBeNull();
	});
});

describe.each(contractSuites())("CdiRateStore (%s)", (_name, make) => {
	let stores: Stores;
	beforeEach(async () => {
		stores = await make();
	});

	it("vazio: latest null, list vazio", async () => {
		expect(await stores.cdiRates.latest()).toBeNull();
		expect(await stores.cdiRates.list()).toEqual([]);
	});

	it("grava, lista por intervalo (inclusivo) e devolve o mais recente", async () => {
		const r = await stores.cdiRates.upsertMany([
			{ day: "2026-11-05", rateE8: 55_131 },
			{ day: "2026-11-03", rateE8: 55_000 },
			{ day: "2026-11-04", rateE8: 0 },
		]);
		expect(r).toEqual({ created: 3, updated: 0 });
		expect((await stores.cdiRates.list()).map((x) => x.day)).toEqual([
			"2026-11-03",
			"2026-11-04",
			"2026-11-05",
		]);
		expect(
			(await stores.cdiRates.list({ from: "2026-11-04", to: "2026-11-04" })).map((x) => x.rateE8),
		).toEqual([0]);
		expect(await stores.cdiRates.latest()).toMatchObject({ day: "2026-11-05", rateE8: 55_131 });
	});

	it("idempotente: repetir não muda nada; valor diferente regrava só o dia", async () => {
		await stores.cdiRates.upsertMany([{ day: "2026-11-03", rateE8: 55_000 }]);
		expect(await stores.cdiRates.upsertMany([{ day: "2026-11-03", rateE8: 55_000 }])).toEqual({
			created: 0,
			updated: 0,
		});
		expect(
			await stores.cdiRates.upsertMany([
				{ day: "2026-11-03", rateE8: 55_001 },
				{ day: "2026-11-04", rateE8: 55_002 },
			]),
		).toEqual({ created: 1, updated: 1 });
		expect((await stores.cdiRates.list()).map((x) => x.rateE8)).toEqual([55_001, 55_002]);
		expect(await stores.cdiRates.upsertMany([])).toEqual({ created: 0, updated: 0 });
	});

	it("tudo ou nada: uma linha inválida desfaz a chamada inteira", async () => {
		for (const bad of [
			{ day: "2026-11-04", rateE8: CDI_DAILY_MAX_E8 + 1 },
			{ day: "2026-11-04", rateE8: -1 },
			{ day: "2026-11-04", rateE8: 1.5 },
			{ day: "2026-02-30", rateE8: 100 },
		]) {
			await expect(
				stores.cdiRates.upsertMany([{ day: "2026-11-03", rateE8: 55_000 }, bad]),
			).rejects.toMatchObject({ code: "invalid" });
		}
		expect(await stores.cdiRates.list()).toEqual([]);
		// O teto exato (0,2% ao dia) é aceito.
		await stores.cdiRates.upsertMany([{ day: "2026-11-04", rateE8: CDI_DAILY_MAX_E8 }]);
		expect(await stores.cdiRates.latest()).toMatchObject({ rateE8: CDI_DAILY_MAX_E8 });
	});
});
