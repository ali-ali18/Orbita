import { createMemoryStores } from "@orbita/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
	BANK_ACCOUNT_ID,
	CARD_ACCOUNT_ID,
	CLIENT_ID,
	CLIENT_SECRET,
	cdbInvestment,
	type FakePluggyOptions,
	fakePluggy,
	INV_CDB_ID,
	INV_STOCK_ID,
	ITEM_ID,
	invTx,
	stockInvestment,
} from "./fake-pluggy.ts";
import { syncPluggy } from "./sync.ts";

// Tudo fictício (ver fake-pluggy.ts). 12/11/2026 06:00 em São Paulo.
const DAY1 = new Date("2026-11-12T09:00:00Z");
const DAY2 = new Date("2026-11-13T09:00:00Z");
const INV_TREASURY_ID = "1a2b3c4d-0000-4aaa-8bbb-000000000201";
const INV_CLOSED_ID = "1a2b3c4d-0000-4aaa-8bbb-000000000202";

const treasury = {
	id: INV_TREASURY_ID,
	itemId: ITEM_ID,
	name: "Tesouro Prefixado 2029",
	type: "FIXED_INCOME",
	subtype: "TREASURY",
	currencyCode: "BRL",
	balance: 2500.4,
	amount: 2510,
	amountOriginal: 2400,
	amountProfit: null,
	dueDate: "2029-01-01T00:00:00.000Z",
	date: "2026-11-11T00:00:00.000Z",
	status: "ACTIVE",
};

/** CDB resgatado por inteiro: saldo zero, `TOTAL_WITHDRAWAL`. */
const closedCdb = {
	id: INV_CLOSED_ID,
	itemId: ITEM_ID,
	name: "CDB Antigo Fictício",
	type: "FIXED_INCOME",
	subtype: "CDB",
	currencyCode: "BRL",
	balance: 0,
	amount: 0,
	amountOriginal: null,
	amountProfit: null,
	date: "2026-09-30T00:00:00.000Z",
	status: "TOTAL_WITHDRAWAL",
};

// Ação sem `amountOriginal` (como no MeuPluggy), com compras e uma venda.
const stock = { ...stockInvestment, amountOriginal: null, amountProfit: null };

function setup(options: FakePluggyOptions = {}) {
	const stores = createMemoryStores({ now: () => clock });
	let clock = DAY1;
	const investments = { [ITEM_ID]: [cdbInvestment, treasury, stock, closedCdb] as unknown[] };
	const fake = fakePluggy({
		// Contas e cartão sem lançamentos, com a fatura do cartão: a rodada termina "ok" sem os investimentos.
		transactions: { [BANK_ACCOUNT_ID]: [], [CARD_ACCOUNT_ID]: [] },
		bills: {
			[CARD_ACCOUNT_ID]: [
				{ id: "bill-nov", dueDate: "2026-11-17T00:00:00.000Z", totalAmount: 0, payments: [] },
			],
		},
		investments,
		investmentTransactions: {
			[INV_STOCK_ID]: [
				invTx("s-1", { type: "BUY", amount: 2000, date: "2026-03-10T00:00:00.000Z" }),
				invTx("s-2", { type: "BUY", amount: 1000, date: "2026-05-10T00:00:00.000Z" }),
				invTx("s-3", { type: "SELL", movementType: "DEBIT", amount: 500, date: "2026-07-10T00:00:00.000Z" }),
			],
			[INV_CDB_ID]: [invTx("c-1", { amount: 10000 })],
			[INV_CLOSED_ID]: [
				invTx("z-1", { amount: 5000 }),
				invTx("z-2", { type: "SELL", movementType: "DEBIT", amount: 5120, date: "2026-09-30T00:00:00.000Z" }),
			],
		},
		...options,
	});
	return {
		stores,
		fake,
		investments,
		setNow: (d: Date) => {
			clock = d;
		},
		run: () =>
			syncPluggy({
				stores,
				readSecret: async (name) => (name === "pluggy_client_id" ? CLIENT_ID : CLIENT_SECRET),
				fetch: fake.fetch,
				now: () => clock,
			}),
		calls: (path: RegExp) => fake.requests.filter((r) => path.test(r.url.pathname)).length,
	};
}

let failing = false;

describe("sync de investimentos", () => {
	let t: ReturnType<typeof setup>;
	beforeEach(async () => {
		t = setup();
		await t.stores.pluggyConnections.add({ id: ITEM_ID, label: "Banco Fictício" });
	});

	it("grava posições (centavos, decimais), arquiva a resgatada, grava o retrato do dia e as movimentações", async () => {
		const result = await t.run();
		expect(result.status).toBe("ok");
		expect(result.connections[0]?.investments).toEqual({
			positions: 4,
			created: 4,
			archived: 0,
			snapshots: 4,
			movementsCreated: 6,
			movementsUpdated: 0,
		});

		const all = await t.stores.investments.list({ includeArchived: true });
		expect(all).toHaveLength(4);
		const byExt = Object.fromEntries(all.map((i) => [i.externalId, i]));
		expect(byExt[INV_CDB_ID]).toMatchObject({
			source: "pluggy",
			connectionId: ITEM_ID,
			type: "FIXED_INCOME",
			subtype: "CDB",
			balanceCents: 1043257,
			grossCents: 1058010,
			investedCents: 1000000,
			profitCents: 43257,
			incomeTaxCents: 14753,
			rate: "110",
			rateType: "CDI",
			positionDate: "2026-11-06",
			dueDate: "2028-05-10",
			issuer: "BANCO FICTICIO S/A",
			archivedAt: null,
		});
		expect(byExt[INV_STOCK_ID]).toMatchObject({
			type: "EQUITY",
			subtype: "STOCK",
			balanceCents: 314500,
			investedCents: null,
			quantity: "100",
			unitValue: "31.45",
		});
		expect(byExt[INV_TREASURY_ID]).toMatchObject({
			subtype: "TREASURY",
			balanceCents: 250040,
			archivedAt: null,
		});
		expect(byExt[INV_CLOSED_ID]).toMatchObject({ status: "TOTAL_WITHDRAWAL", balanceCents: 0 });
		expect(byExt[INV_CLOSED_ID]?.archivedAt).not.toBeNull();

		// Retrato do dia (12/11, fuso de São Paulo), inclusive o zero da resgatada (a passagem para encerrada).
		const snaps = await t.stores.investments.listSnapshots();
		expect(snaps.map((s) => s.day)).toEqual(["2026-11-12", "2026-11-12", "2026-11-12", "2026-11-12"]);
		expect(snaps.find((s) => s.investmentId === byExt[INV_CDB_ID]?.id)).toMatchObject({
			balanceCents: 1043257,
			investedCents: 1000000,
		});

		const moves = await t.stores.investments.listMovements({
			investmentIds: [byExt[INV_STOCK_ID]?.id as string],
		});
		expect(moves.map((m) => [m.externalId, m.type, m.amountCents])).toEqual([
			["s-3", "SELL", 50000],
			["s-2", "BUY", 100000],
			["s-1", "BUY", 200000],
		]);
	});

	it("rodar de novo no mesmo dia não duplica nada (posição, retrato, movimentação)", async () => {
		await t.run();
		const again = await t.run();
		// A resgatada já estava arquivada: não ganha retrato novo, mas as movimentações são relidas (resgate final atrasado).
		expect(again.connections[0]?.investments).toEqual({
			positions: 4,
			created: 0,
			archived: 0,
			snapshots: 3,
			movementsCreated: 0,
			movementsUpdated: 6,
		});
		expect(await t.stores.investments.list({ includeArchived: true })).toHaveLength(4);
		expect(await t.stores.investments.listSnapshots()).toHaveLength(4);
		expect(await t.stores.investments.listMovements()).toHaveLength(6);
		expect(t.calls(new RegExp(`/investments/${INV_CLOSED_ID}/transactions`))).toBe(2);
	});

	it("outro dia: novo retrato; posição que sumiu é arquivada (nunca apagada) e volta quando reaparece", async () => {
		await t.run();
		const list = t.investments[ITEM_ID] as unknown[];
		t.investments[ITEM_ID] = list.filter((p) => (p as { id: string }).id !== INV_TREASURY_ID);
		t.setNow(DAY2);
		const r = await t.run();
		expect(r.connections[0]?.investments).toMatchObject({ archived: 1, snapshots: 2 });
		const gone = (await t.stores.investments.list({ includeArchived: true })).find(
			(i) => i.externalId === INV_TREASURY_ID,
		);
		expect(gone?.archivedAt).not.toBeNull();
		expect(gone?.balanceCents).toBe(250040); // o último saldo conhecido continua lá
		const days = (await t.stores.investments.listSnapshots({ investmentIds: [gone?.id as string] })).map(
			(s) => s.day,
		);
		expect(days).toEqual(["2026-11-12"]);
		expect((await t.stores.investments.listSnapshots()).filter((s) => s.day === "2026-11-13")).toHaveLength(
			2,
		);

		// Voltou para a lista: desarquiva e o retrato do dia é gravado.
		t.investments[ITEM_ID] = list;
		await t.run();
		const back = (await t.stores.investments.list()).find((i) => i.externalId === INV_TREASURY_ID);
		expect(back?.archivedAt).toBeNull();
	});

	it("conexão sem o produto (403/404): sem investimentos, sem nota, contas sincronizam normalmente", async () => {
		for (const status of [403, 404]) {
			const t2 = setup({
				override: (url) => (url.pathname === "/investments" ? new Response("{}", { status }) : undefined),
			});
			await t2.stores.pluggyConnections.add({ id: ITEM_ID, label: "Banco Fictício" });
			const r = await t2.run();
			expect(r.status).toBe("ok");
			expect(r.connections[0]?.notes.filter((n) => /investiment/i.test(n))).toEqual([]);
			expect(r.connections[0]?.investments).toMatchObject({ positions: 0, archived: 0 });
			expect(await t2.stores.investments.list({ includeArchived: true })).toEqual([]);
			expect((await t2.stores.accounts.list()).length).toBeGreaterThan(0);
		}
	});

	it("falha de leitura (500) vira só uma nota: a conexão segue ok e nada é arquivado", async () => {
		const t2 = setup({
			override: (url) =>
				failing && url.pathname === "/investments" ? new Response("{}", { status: 500 }) : undefined,
		});
		await t2.stores.pluggyConnections.add({ id: ITEM_ID, label: "Banco Fictício" });
		await t2.run();
		failing = true;
		t2.setNow(DAY2);
		const r = await t2.run();
		failing = false;
		expect(r.status).toBe("ok");
		expect(r.connections[0]?.notes).toContain("Não consegui ler os investimentos desta vez.");
		expect((await t2.stores.investments.list()).length).toBe(3); // nenhuma arquivada pela falha
		expect((await t2.stores.accounts.list()).length).toBeGreaterThan(0);
	});

	it("linha fora do formato: avisa e NÃO arquiva nada (a descartada pareceria sumida)", async () => {
		await t.run();
		t.investments[ITEM_ID] = [cdbInvestment, { name: "sem id" }];
		t.setNow(DAY2);
		const r = await t.run();
		expect(r.connections[0]?.notes.some((n) => n.includes("fora do formato"))).toBe(true);
		expect(r.connections[0]?.investments?.archived).toBe(0);
		expect((await t.stores.investments.list()).length).toBe(3);
	});

	it("falha ao gravar investimento nunca derruba contas e cartões", async () => {
		t.stores.investments.upsertPosition = async () => {
			throw new Error("banco indisponível: segredo-xyz");
		};
		const r = await t.run();
		expect(r.status).toBe("ok");
		const notes = r.connections[0]?.notes ?? [];
		expect(notes).toContain("4 investimento(s) não puderam ser gravados.");
		expect(JSON.stringify(r)).not.toContain("segredo-xyz");
		expect((await t.stores.accounts.list()).length).toBeGreaterThan(0);
		expect((await t.stores.transactions.listRecent({ limit: 10 })).length).toBeGreaterThanOrEqual(0);
	});

	it("posição com saldo ausente é gravada, mas não ganha retrato (null, nunca zero)", async () => {
		t.investments[ITEM_ID] = [{ id: "bare-1", name: "Caixinha", type: "FIXED_INCOME" }];
		await t.run();
		const [only] = await t.stores.investments.list();
		expect(only).toMatchObject({ externalId: "bare-1", balanceCents: null });
		expect(await t.stores.investments.listSnapshots()).toEqual([]);
	});
});

let failMoves = false;

describe("sync de investimentos: resgate final atrasado e lista vazia", () => {
	it("leitura das movimentações que falha no sync do fechamento é refeita; para depois de 2 leituras boas", async () => {
		const t = setup({
			override: (url) =>
				failMoves && url.pathname === `/investments/${INV_CLOSED_ID}/transactions`
					? new Response("{}", { status: 429 })
					: undefined,
		});
		await t.stores.pluggyConnections.add({ id: ITEM_ID, label: "Banco Fictício" });
		const closedMoves = async () => {
			const closed = (await t.stores.investments.list({ includeArchived: true })).find(
				(i) => i.externalId === INV_CLOSED_ID,
			);
			return t.stores.investments.listMovements({ investmentIds: [closed?.id as string] });
		};
		const reads = () => t.calls(new RegExp(`/investments/${INV_CLOSED_ID}/transactions`));
		failMoves = true;
		await t.run(); // a leitura falha no sync em que a posição aparece fechada
		failMoves = false;
		expect(await closedMoves()).toEqual([]);
		t.setNow(DAY2);
		await t.run(); // próximo sync lê o SELL
		expect((await closedMoves()).map((m) => m.externalId).sort()).toEqual(["z-1", "z-2"]);
		t.setNow(new Date("2026-11-14T09:00:00Z"));
		await t.run(); // segunda leitura boa depois de fechar (pega SELL tardio)
		const before = reads();
		t.setNow(new Date("2026-11-15T09:00:00Z"));
		await t.run(); // já basta: não lê mais
		expect(reads()).toBe(before);
	});

	it("lista vazia 'ok' não arquiva na primeira vez (pode ser falha); na segunda seguida, arquiva", async () => {
		const t = setup();
		await t.stores.pluggyConnections.add({ id: ITEM_ID, label: "Banco Fictício" });
		await t.run();
		t.investments[ITEM_ID] = [];
		t.setNow(DAY2);
		const first = await t.run();
		expect(first.connections[0]?.investments?.archived).toBe(0);
		expect((await t.stores.investments.list()).length).toBe(3);
		t.setNow(new Date("2026-11-14T09:00:00Z"));
		const second = await t.run();
		expect(second.connections[0]?.investments?.archived).toBe(3);
		expect(await t.stores.investments.list()).toEqual([]);
	});
});
