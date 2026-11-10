import { beforeEach, describe, expect, it } from "vitest";
import { contractSuites } from "./contract-harness.ts";
import type { Stores } from "./stores.ts";

// Tudo fictício. Os mesmos casos rodam na memória e no Postgres.

const base = { source: "pluggy", externalId: "pos-1", connectionId: "item-1" };

describe.each(contractSuites())("InvestmentStore (%s)", (_name, make) => {
	let stores: Stores;
	beforeEach(async () => {
		stores = await make();
	});

	it("cria a posição com centavos, decimais canônicos e datas; ausente fica null (nunca zero)", async () => {
		const { record, created, wasArchived } = await stores.investments.upsertPosition({
			...base,
			type: "FIXED_INCOME",
			subtype: "CDB",
			name: "  CDB Banco Fictício  ",
			status: "ACTIVE",
			balanceCents: 1043257,
			investedCents: 1000000,
			profitCents: -500,
			quantity: "1.2500",
			unitValue: "31.45",
			rate: "110",
			dueDate: "2028-05-10",
		});
		expect({ created, wasArchived }).toEqual({ created: true, wasArchived: false });
		expect(record).toMatchObject({
			source: "pluggy",
			externalId: "pos-1",
			connectionId: "item-1",
			name: "CDB Banco Fictício",
			balanceCents: 1043257,
			investedCents: 1000000,
			profitCents: -500,
			grossCents: null,
			withdrawableCents: null,
			quantity: "1.25",
			unitValue: "31.45",
			rate: "110",
			annualRate: null,
			dueDate: "2028-05-10",
			purchaseDate: null,
			archivedAt: null,
		});
		expect(await stores.investments.get(record.id)).toEqual(record);
		expect(await stores.investments.get("nada")).toBeNull();
	});

	it("o mesmo (source, externalId) regrava a mesma linha, sem duplicar", async () => {
		const first = await stores.investments.upsertPosition({ ...base, balanceCents: 100, name: "A" });
		const second = await stores.investments.upsertPosition({ ...base, balanceCents: 250 });
		expect(second.created).toBe(false);
		expect(second.record.id).toBe(first.record.id);
		// A posição é regravada por inteiro: o que não veio agora volta a null.
		expect(second.record).toMatchObject({ balanceCents: 250, name: null });
		expect(second.record.syncedAt.getTime()).toBeGreaterThan(first.record.syncedAt.getTime());
		expect(await stores.investments.list()).toHaveLength(1);
		// Outra origem com o mesmo id externo é outra posição.
		await stores.investments.upsertPosition({ ...base, source: "outra", balanceCents: 1 });
		expect(await stores.investments.list()).toHaveLength(2);
	});

	it("TOTAL_WITHDRAWAL arquiva (guardando o primeiro instante) e outra situação desarquiva; nunca apaga", async () => {
		const open = await stores.investments.upsertPosition({ ...base, status: "ACTIVE", balanceCents: 5 });
		const closed = await stores.investments.upsertPosition({
			...base,
			status: "TOTAL_WITHDRAWAL",
			balanceCents: 0,
		});
		expect(closed.wasArchived).toBe(false);
		expect(closed.record.archivedAt).not.toBeNull();
		const again = await stores.investments.upsertPosition({
			...base,
			status: "TOTAL_WITHDRAWAL",
			balanceCents: 0,
		});
		expect(again.wasArchived).toBe(true);
		expect(again.record.archivedAt).toEqual(closed.record.archivedAt);
		expect(await stores.investments.list()).toEqual([]);
		expect((await stores.investments.list({ includeArchived: true })).map((i) => i.id)).toEqual([
			open.record.id,
		]);
		const back = await stores.investments.upsertPosition({ ...base, status: "ACTIVE", balanceCents: 7 });
		expect(back.record.archivedAt).toBeNull();
		expect(await stores.investments.list()).toHaveLength(1);
	});

	it("archiveMissing arquiva só as da conexão que sumiram da lista", async () => {
		await stores.investments.upsertPosition({ ...base, externalId: "a" });
		await stores.investments.upsertPosition({ ...base, externalId: "b" });
		await stores.investments.upsertPosition({ ...base, externalId: "c", connectionId: "item-2" });
		expect(await stores.investments.archiveMissing("pluggy", "item-1", ["a"])).toBe(1);
		expect((await stores.investments.list()).map((i) => i.externalId)).toEqual(["a", "c"]);
		// Já arquivada não é arquivada de novo; lista vazia arquiva as restantes da conexão.
		expect(await stores.investments.archiveMissing("pluggy", "item-1", ["a"])).toBe(0);
		expect(await stores.investments.archiveMissing("pluggy", "item-1", [])).toBe(1);
		expect((await stores.investments.list({ connectionId: "item-2" })).map((i) => i.externalId)).toEqual([
			"c",
		]);
		expect(await stores.investments.list({ includeArchived: true })).toHaveLength(3);
	});

	it("recusa dado inválido com a mesma mensagem", async () => {
		await expect(stores.investments.upsertPosition({ ...base, balanceCents: 10.5 })).rejects.toMatchObject({
			code: "invalid",
			message: "O saldo deve ser um inteiro de centavos.",
		});
		await expect(stores.investments.upsertPosition({ ...base, quantity: "1e5" })).rejects.toMatchObject({
			code: "invalid",
		});
		await expect(stores.investments.upsertPosition({ ...base, dueDate: "2028-02-30" })).rejects.toMatchObject(
			{
				code: "invalid",
				message: "A data de vencimento é inválida (use AAAA-MM-DD).",
			},
		);
		await expect(stores.investments.upsertPosition({ ...base, externalId: "  " })).rejects.toMatchObject({
			code: "invalid",
		});
	});

	it("retrato diário: idempotente por (posição, dia), sem saldo não grava, dia livre de fuso", async () => {
		const { record } = await stores.investments.upsertPosition(base);
		expect(
			await stores.investments.upsertSnapshot(record.id, { day: "2026-11-05", balanceCents: null }),
		).toBeNull();
		expect(await stores.investments.listSnapshots()).toEqual([]);
		const a = await stores.investments.upsertSnapshot(record.id, {
			day: "2026-11-05",
			balanceCents: 1000,
			investedCents: 900,
			quantity: "2.50",
		});
		expect(a).toMatchObject({
			day: "2026-11-05",
			balanceCents: 1000,
			investedCents: 900,
			grossCents: null,
			quantity: "2.5",
		});
		// Refazer no mesmo dia sobrescreve (a leitura mais nova do dia vale).
		const b = await stores.investments.upsertSnapshot(record.id, { day: "2026-11-05", balanceCents: 1100 });
		expect(b?.id).toBe(a?.id);
		expect(b).toMatchObject({ balanceCents: 1100, investedCents: null, quantity: null });
		await stores.investments.upsertSnapshot(record.id, { day: "2026-11-03", balanceCents: 0 });
		await stores.investments.upsertSnapshot(record.id, { day: "2026-12-01", balanceCents: 1200 });
		expect((await stores.investments.listSnapshots()).map((s) => [s.day, s.balanceCents])).toEqual([
			["2026-11-03", 0],
			["2026-11-05", 1100],
			["2026-12-01", 1200],
		]);
		expect(
			(await stores.investments.listSnapshots({ from: "2026-11-04", to: "2026-11-30" })).map((s) => s.day),
		).toEqual(["2026-11-05"]);
		expect(await stores.investments.listSnapshots({ investmentIds: ["outra"] })).toEqual([]);
		await expect(
			stores.investments.upsertSnapshot("fantasma", { day: "2026-11-05", balanceCents: 1 }),
		).rejects.toMatchObject({ code: "not_found" });
	});

	it("movimentações: idempotentes pelo id, regravam o que o banco corrigiu, ordenadas da mais recente", async () => {
		const { record } = await stores.investments.upsertPosition(base);
		const rows = [
			{
				externalId: "m1",
				type: "BUY",
				movementType: "CREDIT",
				date: "2026-05-10",
				amountCents: 100000,
				quantity: "10",
				unitValue: "100",
			},
			{
				externalId: "m2",
				type: "SELL",
				movementType: "DEBIT",
				date: "2026-06-10",
				amountCents: 50000,
				netAmountCents: 49900,
				description: "Resgate",
			},
			{ externalId: "m3", type: "TAX" },
		];
		expect(await stores.investments.upsertMovements(record.id, rows)).toEqual({ created: 3, updated: 0 });
		expect(await stores.investments.upsertMovements(record.id, rows)).toEqual({ created: 0, updated: 3 });
		const fixed = [
			{
				externalId: "m1",
				amountCents: 100500,
				date: "2026-05-10",
				quantity: "10",
				unitValue: "100",
				type: "BUY",
				movementType: "CREDIT",
			},
		];
		expect(await stores.investments.upsertMovements(record.id, fixed)).toEqual({ created: 0, updated: 1 });
		const all = await stores.investments.listMovements();
		expect(all.map((m) => m.externalId)).toEqual(["m2", "m1", "m3"]);
		expect(all.find((m) => m.externalId === "m1")).toMatchObject({
			investmentId: record.id,
			source: "pluggy",
			amountCents: 100500,
			quantity: "10",
			unitValue: "100",
			date: "2026-05-10",
			tradeDate: null,
		});
		expect(all.find((m) => m.externalId === "m2")?.netAmountCents).toBe(49900);
		// Com filtro de datas, a sem data fica de fora.
		expect(
			(await stores.investments.listMovements({ from: "2026-06-01", to: "2026-06-30" })).map(
				(m) => m.externalId,
			),
		).toEqual(["m2"]);
		expect(await stores.investments.listMovements({ investmentIds: ["outra"] })).toEqual([]);
	});

	it("movimentação que já é de outra posição é recusada e nada da chamada é gravado", async () => {
		const a = await stores.investments.upsertPosition(base);
		const b = await stores.investments.upsertPosition({ ...base, externalId: "pos-2" });
		await stores.investments.upsertMovements(a.record.id, [{ externalId: "m1", date: "2026-05-10" }]);
		await expect(
			stores.investments.upsertMovements(b.record.id, [{ externalId: "novo" }, { externalId: "m1" }]),
		).rejects.toMatchObject({ code: "invalid" });
		expect((await stores.investments.listMovements()).map((m) => m.externalId)).toEqual(["m1"]);
		await expect(stores.investments.upsertMovements("fantasma", [{ externalId: "x" }])).rejects.toMatchObject(
			{
				code: "not_found",
			},
		);
	});
});

describe.each(contractSuites())("InvestmentStore: marcadores de leitura (%s)", (_name, make) => {
	let stores: Stores;
	beforeEach(async () => {
		stores = await make();
	});

	it("archiveMissing com mínimo de leituras ausentes: só arquiva na enésima seguida; reaparecer zera", async () => {
		const a = await stores.investments.upsertPosition({ ...base, externalId: "a" });
		await stores.investments.upsertPosition({ ...base, externalId: "b" });
		expect(a.record.missingReads).toBe(0);
		// Lista vazia 1ª vez: nada arquivado, contador sobe.
		expect(await stores.investments.archiveMissing("pluggy", "item-1", [], 2)).toBe(0);
		expect((await stores.investments.list()).map((i) => i.missingReads)).toEqual([1, 1]);
		// "a" volta: contador dela zera; a 2ª leitura vazia arquiva só "b".
		await stores.investments.upsertPosition({ ...base, externalId: "a" });
		expect(await stores.investments.archiveMissing("pluggy", "item-1", [], 2)).toBe(1);
		expect((await stores.investments.list()).map((i) => [i.externalId, i.missingReads])).toEqual([["a", 1]]);
	});

	it("movimentações lidas depois de arquivar: o contador sobe só se arquivada e zera ao desarquivar", async () => {
		const { record } = await stores.investments.upsertPosition({ ...base, status: "ACTIVE" });
		expect(await stores.investments.markMovementsRead(record.id, "2026-11-10")).toBe(0);
		const closed = await stores.investments.upsertPosition({
			...base,
			status: "TOTAL_WITHDRAWAL",
			balanceCents: 0,
		});
		expect(closed.record.movementsClosedReads).toBe(0);
		expect(await stores.investments.markMovementsRead(record.id, "2026-11-10")).toBe(1);
		// No máximo uma leitura contada por dia (syncs manuais não queimam o mínimo).
		expect(await stores.investments.markMovementsRead(record.id, "2026-11-10")).toBe(1);
		expect(await stores.investments.markMovementsRead(record.id, "2026-11-11")).toBe(2);
		// Regravar a posição encerrada não zera.
		const again = await stores.investments.upsertPosition({
			...base,
			status: "TOTAL_WITHDRAWAL",
			balanceCents: 0,
		});
		expect(again.record.movementsClosedReads).toBe(2);
		const back = await stores.investments.upsertPosition({ ...base, status: "ACTIVE", balanceCents: 5 });
		expect(back.record.movementsClosedReads).toBe(0);
		await expect(stores.investments.markMovementsRead("fantasma", "2026-11-10")).rejects.toMatchObject({
			code: "not_found",
		});
	});
});
