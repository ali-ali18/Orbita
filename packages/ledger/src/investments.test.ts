import { createMemoryStores, type Stores } from "@orbita/db";
import {
	investmentDetailResponse,
	investmentEvolutionResponse,
	investmentsOverviewResponse,
} from "@orbita/shared";
import { describe, expect, it } from "vitest";
import {
	connectionInvestmentCounts,
	investmentDetail,
	investmentEvolutionSeries,
	investmentsOverview,
} from "./investments.ts";

// Tudo fictício. "Hoje" é 15/11/2026.
const TODAY = "2026-11-15";
const NOW = new Date("2026-11-15T15:00:00Z");
const ITEM_A = "11111111-1111-4111-8111-111111111111";
const ITEM_B = "22222222-2222-4222-8222-222222222222";

async function seed() {
	const stores: Stores = createMemoryStores({ now: () => NOW });
	await stores.pluggyConnections.add({ id: ITEM_A, label: "Banco A", byOwner: true });
	await stores.pluggyConnections.add({ id: ITEM_B, label: "MeuPluggy" });
	const cdb = (
		await stores.investments.upsertPosition({
			source: "pluggy",
			externalId: "cdb",
			connectionId: ITEM_A,
			type: "FIXED_INCOME",
			subtype: "CDB",
			name: "CDB Fictício",
			status: "ACTIVE",
			currency: "BRL",
			balanceCents: 1020000,
			investedCents: 1000000,
			quantity: "1.5",
		})
	).record;
	const acao = (
		await stores.investments.upsertPosition({
			source: "pluggy",
			externalId: "acao",
			connectionId: ITEM_B,
			type: "EQUITY",
			subtype: "STOCK",
			name: "EXEM3",
			code: "EXEM3",
			status: "ACTIVE",
			balanceCents: 310000,
			unitValue: "31",
			quantity: "100",
		})
	).record;
	const resgatado = (
		await stores.investments.upsertPosition({
			source: "pluggy",
			externalId: "velho",
			connectionId: ITEM_A,
			type: "FIXED_INCOME",
			subtype: "LCI",
			status: "TOTAL_WITHDRAWAL",
			balanceCents: 0,
		})
	).record;
	await stores.investments.upsertMovements(acao.id, [
		{ externalId: "m1", type: "BUY", movementType: "CREDIT", date: "2026-03-10", amountCents: 300000 },
		{ externalId: "m2", type: "TAX", date: "2026-03-10", amountCents: 50 },
	]);
	return { stores, cdb, acao, resgatado };
}

describe("resumo de investimentos", () => {
	it("sem nada sincronizado: vazio, sem inventar", async () => {
		const stores = createMemoryStores({ now: () => NOW });
		const r = await investmentsOverview(stores, { today: TODAY });
		expect(investmentsOverviewResponse.parse(r)).toEqual(r);
		expect(r).toMatchObject({
			hasData: false,
			syncedAt: null,
			totalCents: 0,
			activePositions: 0,
			positions: [],
			byClass: [],
			byInstitution: [],
		});
		expect(r.yield.total).toMatchObject({ cents: null, reason: "sem posições ativas" });
		expect(r.yield.month).toMatchObject({ cents: null, reason: "sem posições" });
	});

	it("patrimônio, rendimento exato e estimado, grupos e posições (do maior saldo)", async () => {
		const { stores } = await seed();
		const r = await investmentsOverview(stores, { today: TODAY });
		expect(investmentsOverviewResponse.parse(r)).toEqual(r);
		expect(r).toMatchObject({
			asOf: TODAY,
			hasData: true,
			totalCents: 1330000,
			activePositions: 2,
			closedPositions: 1,
			withoutBalance: 0,
			foreignCurrency: 0,
		});
		expect(r.yield.total).toEqual({
			// CDB: 1.020.000 − 1.000.000 (exato); ação: 310.000 − 300.000 (estimado).
			cents: 30000,
			estimated: true,
			returnBps: 231,
			countedPositions: 2,
			missingPositions: 0,
			reason: null,
		});
		// Sem retrato do fim do mês anterior: não inventa.
		expect(r.yield.month).toMatchObject({ cents: null, reason: "sem histórico ainda", partial: false });
		expect(r.byClass.map((g) => [g.class, g.label, g.balanceCents])).toEqual([
			["fixed_income", "Renda fixa", 1020000],
			["equity", "Ações", 310000],
		]);
		// Conexão "MeuPluggy" sem nome verdadeiro aparece como "Banco novo", como no app.
		expect(r.byInstitution.map((g) => [g.key, g.label])).toEqual([
			[ITEM_A, "Banco A"],
			[ITEM_B, "Banco novo"],
		]);
		expect(r.positions.map((p) => p.name)).toEqual(["CDB Fictício", "EXEM3"]);
		expect(r.positions[0]).toMatchObject({
			class: "fixed_income",
			classLabel: "Renda fixa",
			subtypeLabel: "CDB",
			active: true,
			institutionLabel: "Banco A",
			quantity: "1.5",
			yield: { cents: 20000, estimated: false, basis: "invested", returnBps: 200, reason: null },
		});
		expect(r.positions[1]?.yield).toMatchObject({ cents: 10000, estimated: true, basis: "movements" });
		expect(r.monthly).toHaveLength(6);
		expect(r.monthly[0]?.month).toBe("2026-06");
	});

	it("rendimento do mês com retratos do fim do mês anterior", async () => {
		const { stores, cdb, acao } = await seed();
		await stores.investments.upsertSnapshot(cdb.id, { day: "2026-10-31", balanceCents: 1010000 });
		await stores.investments.upsertSnapshot(acao.id, { day: "2026-10-31", balanceCents: 300000 });
		await stores.investments.upsertMovements(acao.id, [
			{ externalId: "m3", type: "BUY", date: "2026-11-05", amountCents: 5000 },
		]);
		const r = await investmentsOverview(stores, { today: TODAY });
		// CDB +10.000; ação 310.000 − 300.000 − 5.000 = +5.000.
		expect(r.yield.month).toMatchObject({
			cents: 15000,
			partial: false,
			countedPositions: 2,
			baselineDay: "2026-10-31",
			reason: null,
		});
		expect(r.monthly[5]).toMatchObject({ month: "2026-11", contributionsCents: 5000, yieldCents: 15000 });
	});

	it("posição de conexão removida não entra (nem soma saldo parado nem duplica a conexão que a substituiu)", async () => {
		const { stores } = await seed();
		await stores.pluggyConnections.remove(ITEM_B);
		const r = await investmentsOverview(stores, { today: TODAY });
		expect(r.totalCents).toBe(1020000);
		expect(r.positions.map((p) => p.name)).toEqual(["CDB Fictício"]);
		expect(r.byInstitution.map((g) => g.label)).toEqual(["Banco A"]);
	});

	it("saldo ausente, outra moeda e posição que sumiu ficam de fora da soma e são contados", async () => {
		const { stores } = await seed();
		await stores.investments.upsertPosition({
			source: "pluggy",
			externalId: "semsaldo",
			connectionId: ITEM_A,
			type: "FIXED_INCOME",
			status: "ACTIVE",
		});
		await stores.investments.upsertPosition({
			source: "pluggy",
			externalId: "usd",
			connectionId: ITEM_A,
			type: "OTHER",
			currency: "USD",
			balanceCents: 999,
		});
		await stores.investments.archiveMissing("pluggy", ITEM_B, []);
		const r = await investmentsOverview(stores, { today: TODAY });
		expect(r).toMatchObject({
			totalCents: 1020000,
			activePositions: 2,
			withoutBalance: 1,
			foreignCurrency: 1,
		});
		expect(r.closedPositions).toBe(2);
	});
});

describe("detalhe", () => {
	it("posição com movimentações (mais recente primeiro) e retratos; encerrada também abre; inexistente é null", async () => {
		const { stores, acao, resgatado } = await seed();
		await stores.investments.upsertSnapshot(acao.id, { day: "2026-11-10", balanceCents: 305000 });
		const d = await investmentDetail(stores, acao.id);
		expect(investmentDetailResponse.parse(d)).toEqual(d);
		expect(d?.position).toMatchObject({ name: "EXEM3", code: "EXEM3", unitValue: "31", quantity: "100" });
		expect(d?.movements.map((m) => [m.type, m.kind])).toEqual([
			["TAX", "other"],
			["BUY", "contribution"],
		]);
		expect(d?.snapshots).toEqual([{ day: "2026-11-10", balanceCents: 305000, investedCents: null }]);
		const closed = await investmentDetail(stores, resgatado.id);
		expect(closed?.position).toMatchObject({ active: false, status: "TOTAL_WITHDRAWAL" });
		expect(closed?.movements).toEqual([]);
		expect(await investmentDetail(stores, "nada")).toBeNull();
	});
});

describe("evolução", () => {
	it("sem retratos: série vazia com motivo", async () => {
		const { stores } = await seed();
		const r = await investmentEvolutionSeries(stores, "6m", { today: TODAY });
		expect(investmentEvolutionResponse.parse(r)).toEqual(r);
		expect(r).toMatchObject({
			range: "6m",
			from: "2026-05-15",
			to: TODAY,
			coveredFrom: null,
			points: [],
			reason: "sem histórico ainda",
		});
	});

	it("série diária da faixa, sem preencher dias faltantes", async () => {
		const { stores, cdb, acao } = await seed();
		await stores.investments.upsertSnapshot(cdb.id, {
			day: "2026-08-01",
			balanceCents: 1000000,
			investedCents: 1000000,
		});
		await stores.investments.upsertSnapshot(cdb.id, {
			day: "2026-11-03",
			balanceCents: 1015000,
			investedCents: 1000000,
		});
		await stores.investments.upsertSnapshot(acao.id, { day: "2026-11-03", balanceCents: 305000 });
		await stores.investments.upsertSnapshot(cdb.id, {
			day: "2026-11-09",
			balanceCents: 1018000,
			investedCents: 1000000,
		});
		const month = await investmentEvolutionSeries(stores, "1m", { today: TODAY });
		expect(month.from).toBe("2026-10-15");
		expect(month.coveredFrom).toBe("2026-08-01");
		expect(month.points.map((p) => [p.day, p.balanceCents, p.investedCents, p.investedEstimated])).toEqual([
			["2026-11-03", 1320000, 1300000, true],
			["2026-11-09", 1018000, 1000000, false],
		]);
		const year = await investmentEvolutionSeries(stores, "1y", { today: TODAY });
		expect(year.points.map((p) => p.day)).toEqual(["2026-08-01", "2026-11-03", "2026-11-09"]);
		expect(year.reason).toBeNull();
	});
});

describe("revisão: encerrada e conexão removida", () => {
	it("posição encerrada: ganho realizado estimado só depois de 2 leituras boas das movimentações; antes, null com motivo", async () => {
		const { stores, resgatado } = await seed();
		await stores.investments.upsertMovements(resgatado.id, [
			{ externalId: "z1", type: "BUY", date: "2026-01-10", amountCents: 100000 },
			{ externalId: "z2", type: "SELL", date: "2026-09-30", amountCents: 105000 },
		]);
		const before = await investmentDetail(stores, resgatado.id);
		expect(before?.position.yield).toMatchObject({ cents: null, basis: "unavailable" });
		await stores.investments.markMovementsRead(resgatado.id, "2026-11-10");
		await stores.investments.markMovementsRead(resgatado.id, "2026-11-11");
		const after = await investmentDetail(stores, resgatado.id);
		expect(investmentDetailResponse.parse(after)).toEqual(after);
		expect(after?.position.yield).toMatchObject({ cents: 5000, estimated: true, basis: "movements" });
	});

	it("detalhe de posição de conexão removida: 200, inativa e 'Conexão removida'", async () => {
		const { stores, acao } = await seed();
		await stores.pluggyConnections.remove(ITEM_B);
		const d = await investmentDetail(stores, acao.id);
		expect(d?.position).toMatchObject({ active: false, institutionLabel: "Conexão removida" });
		expect(d?.position.yield).toMatchObject({
			cents: null,
			reason: "conexão removida: sem dados atuais para calcular",
		});
	});

	it("evolução expõe retratos carregados e posições faltando", async () => {
		const { stores, cdb, acao } = await seed();
		await stores.investments.upsertSnapshot(acao.id, { day: "2026-11-03", balanceCents: 305000 });
		await stores.investments.upsertSnapshot(cdb.id, { day: "2026-11-03", balanceCents: 1015000 });
		await stores.investments.upsertSnapshot(cdb.id, { day: "2026-11-05", balanceCents: 1016000 });
		const r = await investmentEvolutionSeries(stores, "1m", { today: TODAY });
		expect(investmentEvolutionResponse.parse(r)).toEqual(r);
		expect(r.points[1]).toMatchObject({
			balanceCents: 1321000,
			positions: 1,
			carriedPositions: 1,
			missingPositions: 0,
		});
	});
});

describe("posições por conexão", () => {
	it("conta ativas e encerradas de cada conexão; conexão sem posição não aparece", async () => {
		const { stores } = await seed();
		const counts = await connectionInvestmentCounts(stores);
		expect(counts.get(ITEM_A)).toEqual({ active: 1, noBalance: 0, closed: 1, foreignCurrency: 0 });
		expect(counts.get(ITEM_B)).toEqual({ active: 1, noBalance: 0, closed: 0, foreignCurrency: 0 });
		expect(counts.size).toBe(2);
	});

	it('saldo zero ainda ativa no banco é "sem saldo" (não encerrada); saldo desconhecido conta como ativa; outra moeda à parte', async () => {
		const stores = createMemoryStores({ now: () => NOW });
		await stores.pluggyConnections.add({ id: ITEM_A, label: "Banco A" });
		await stores.investments.upsertPosition({
			source: "pluggy",
			externalId: "zero",
			connectionId: ITEM_A,
			type: "FIXED_INCOME",
			subtype: "CDB",
			status: "ACTIVE",
			balanceCents: 0,
		});
		await stores.investments.upsertPosition({
			source: "pluggy",
			externalId: "sem-saldo",
			connectionId: ITEM_A,
			type: "FIXED_INCOME",
			subtype: "CDB",
			status: "ACTIVE",
			balanceCents: null,
		});
		await stores.investments.upsertPosition({
			source: "pluggy",
			externalId: "dolar",
			connectionId: ITEM_A,
			type: "FIXED_INCOME",
			subtype: "CDB",
			status: "ACTIVE",
			currency: "USD",
			balanceCents: 5000,
		});
		expect((await connectionInvestmentCounts(stores)).get(ITEM_A)).toEqual({
			active: 1,
			noBalance: 1,
			closed: 0,
			foreignCurrency: 1,
		});
	});
});

describe("conexão só com investimento encerrado", () => {
	it("não entra no patrimônio nem nas instituições (certo: saldo zero), mas a conexão conta a posição encerrada", async () => {
		const stores = createMemoryStores({ now: () => NOW });
		await stores.pluggyConnections.add({ id: ITEM_A, label: "Banco A" });
		await stores.investments.upsertPosition({
			source: "pluggy",
			externalId: "antigo",
			connectionId: ITEM_A,
			type: "FIXED_INCOME",
			subtype: "CDB",
			status: "TOTAL_WITHDRAWAL",
			balanceCents: 0,
		});
		const r = await investmentsOverview(stores, { today: TODAY });
		expect(r.totalCents).toBe(0);
		expect(r.byInstitution).toEqual([]);
		expect(r.closedPositions).toBe(1);
		expect((await connectionInvestmentCounts(stores)).get(ITEM_A)).toEqual({
			active: 0,
			noBalance: 0,
			closed: 1,
			foreignCurrency: 0,
		});
	});
});
