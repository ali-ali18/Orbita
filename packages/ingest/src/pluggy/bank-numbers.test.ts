import { createMemoryStores } from "@orbita/db";
import { beforeEach, describe, expect, it } from "vitest";
import { signedCentsOrNull } from "./balances.ts";
import { CLIENT_ID, CLIENT_SECRET, type FakePluggyOptions, fakePluggy, ITEM_ID } from "./fake-pluggy.ts";
import { accountSchema, billSchema } from "./schemas.ts";
import { type SyncPluggyDeps, syncPluggy } from "./sync.ts";

const NOW = new Date("2026-11-12T09:00:00Z");
const LATER = new Date("2026-11-13T09:00:00Z");

type Json = Record<string, unknown>;

const bank = (id: string, name: string, balance: number | string | null): Json => ({
	id,
	type: "BANK",
	subtype: "CHECKING_ACCOUNT",
	name,
	marketingName: null,
	number: `${id}-0`,
	owner: "FULANO DE TAL",
	taxNumber: "123.456.789-00",
	balance,
	currencyCode: "BRL",
	itemId: ITEM_ID,
	creditData: null,
});

const card = (
	id: string,
	last4: string,
	limit: number,
	available: number | string | null | undefined,
	name = `Cartão ${last4}`,
): Json => ({
	id,
	type: "CREDIT",
	subtype: "CREDIT_CARD",
	name,
	marketingName: name,
	number: `5502 **** **** ${last4}`,
	owner: "FULANO DE TAL",
	taxNumber: "123.456.789-00",
	balance: limit - 1,
	currencyCode: "BRL",
	itemId: ITEM_ID,
	creditData: {
		level: "GOLD",
		brand: "MASTERCARD",
		balanceCloseDate: "2026-11-10T00:00:00.000Z",
		balanceDueDate: "2026-11-17T00:00:00.000Z",
		creditLimit: limit,
		...(available === undefined ? {} : { availableCreditLimit: available }),
	},
});

// Os números reais do dono: limite e disponível de cada cartão; saldo da conta Mercado Pago e das demais.
const OWNER_CARDS = [
	card("cc-1", "1111", 5770, 5232.67),
	card("cc-2", "2222", 2900, 2561.44),
	card("cc-3", "3333", 5660, 5351),
	card("cc-4", "4444", 7000, 6131.3),
];
const OWNER_ACCOUNTS = [
	bank("ba-mp", "Mercado Pago", 205.35),
	bank("ba-2", "Conta Inter", 0),
	bank("ba-3", "Conta Digital", 0),
];

const bill = (id: string, extra: Json = {}): Json => ({
	id,
	dueDate: "2026-11-17T00:00:00.000Z",
	totalAmount: 537.33,
	payments: [],
	...extra,
});

// Sem lançamentos: o foco aqui são os números do banco (sem `transactions` o fake responde 404 e a rodada fica parcial).
const BASE: FakePluggyOptions = {
	accounts: [...OWNER_ACCOUNTS, ...OWNER_CARDS],
	transactions: Object.fromEntries(
		["ba-mp", "ba-2", "ba-3", "cc-1", "cc-2", "cc-3", "cc-4"].map((id) => [id, []]),
	),
};

function setup(options: FakePluggyOptions = {}) {
	const stores = createMemoryStores({ now: () => NOW });
	let fake = fakePluggy({ ...BASE, ...options });
	let clock = NOW;
	const deps = (): SyncPluggyDeps => ({
		stores,
		readSecret: async (name) => (name === "pluggy_client_id" ? CLIENT_ID : CLIENT_SECRET),
		fetch: fake.fetch,
		now: () => clock,
	});
	return {
		stores,
		run: () => syncPluggy(deps()),
		setNow: (d: Date) => {
			clock = d;
		},
		/** Troca o que o Pluggy responde (a conexão e os cadastros do Órbita ficam). */
		change: (next: FakePluggyOptions) => {
			fake = fakePluggy({ ...BASE, ...next });
		},
	};
}

const byName = async (stores: ReturnType<typeof setup>["stores"], fragment: string) => {
	const found = (await stores.accounts.list()).find((a) => a.name.includes(fragment));
	if (!found) throw new Error(`sem conta ${fragment}`);
	return found;
};
const byLast4 = async (stores: ReturnType<typeof setup>["stores"], last4: string) => {
	const found = (await stores.cards.list()).find((c) => c.last4 === last4);
	if (!found) throw new Error(`sem cartão ${last4}`);
	return found;
};

describe("números que o banco informa (saldo, limite disponível, faturas)", () => {
	let t: ReturnType<typeof setup>;
	beforeEach(async () => {
		t = setup({
			bills: {
				"cc-1": [
					bill("bill-a", {
						billClosingDate: "2026-11-10T00:00:00.000Z",
						minimumPaymentAmount: 80.75,
						payments: [
							{
								id: "pay-1",
								paymentDate: "2026-10-12T00:00:00.000Z",
								amount: 100.1 + 0.2,
								currencyCode: "BRL",
							},
						],
					}),
					bill("bill-b", { dueDate: "2026-10-17T00:00:00.000Z", totalAmount: 1200 }),
				],
				"cc-2": [bill("bill-c", { totalAmount: 338.56 })],
			},
		});
		await t.stores.pluggyConnections.add({ id: ITEM_ID, label: "Banco" });
	});

	it("grava saldo da conta e limite disponível dos cartões em centavos, com o relógio injetado", async () => {
		const result = await t.run();
		expect(result.status).toBe("ok");

		expect(await byName(t.stores, "Mercado Pago")).toMatchObject({
			balanceCents: 20_535,
			balanceSyncedAt: NOW,
		});
		expect(await byName(t.stores, "Conta Inter")).toMatchObject({ balanceCents: 0, balanceSyncedAt: NOW });
		expect(await byName(t.stores, "Digital")).toMatchObject({ balanceCents: 0, balanceSyncedAt: NOW });

		const limits = await Promise.all(["1111", "2222", "3333", "4444"].map((l) => byLast4(t.stores, l)));
		expect(limits.map((c) => [c.limitCents, c.availableCents])).toEqual([
			[577_000, 523_267],
			[290_000, 256_144],
			[566_000, 535_100],
			[700_000, 613_130],
		]);
		expect(limits.every((c) => c.limitSyncedAt?.getTime() === NOW.getTime())).toBe(true);
		expect(result.connections[0]?.bankNumbers).toMatchObject({ balances: 3, limits: 4, bills: 3 });
	});

	it("grava as faturas com total, datas, mínimo e pagamentos", async () => {
		await t.run();
		const c1 = await byLast4(t.stores, "1111");
		const bills = await t.stores.bills.listByCard(c1.id);
		expect(bills.map((b) => b.externalId)).toEqual(["bill-a", "bill-b"]);
		expect(bills[0]).toMatchObject({
			cardId: c1.id,
			source: "pluggy",
			closeDate: "2026-11-10",
			dueDate: "2026-11-17",
			totalAmountCents: 53_733,
			minimumPaymentCents: 8_075,
			currency: "BRL",
			syncedAt: NOW,
			// 100.1 + 0.2 é 100.30000000000001 em float: vira 10030 centavos, não 10030.000000000002.
			payments: [{ externalId: "pay-1", amountCents: 10_030, date: "2026-10-12" }],
		});
		expect(bills[1]).toMatchObject({ closeDate: null, minimumPaymentCents: null, totalAmountCents: 120_000 });
		const c2 = await byLast4(t.stores, "2222");
		expect((await t.stores.bills.listByCard(c2.id)).map((b) => b.totalAmountCents)).toEqual([33_856]);
	});

	it("sync repetido é idempotente: nada duplica e o instante da leitura avança", async () => {
		await t.run();
		const before = await t.stores.bills.list();
		t.setNow(LATER);
		await t.run();
		const after = await t.stores.bills.list();
		expect(after.map((b) => b.id).sort()).toEqual(before.map((b) => b.id).sort());
		expect(after).toHaveLength(3);
		expect(after.every((b) => b.syncedAt.getTime() === LATER.getTime())).toBe(true);
		expect((await t.stores.accounts.list()).filter((a) => a.name.includes("Mercado"))).toHaveLength(1);
		expect(await byName(t.stores, "Mercado Pago")).toMatchObject({
			balanceCents: 20_535,
			balanceSyncedAt: LATER,
		});
		expect(await byLast4(t.stores, "1111")).toMatchObject({ availableCents: 523_267, limitSyncedAt: LATER });
	});

	it("o banco mudou o número: o valor novo vence; os pagamentos da fatura são os do banco", async () => {
		await t.run();
		t.change({
			accounts: [
				bank("ba-mp", "Mercado Pago", -12.5),
				...OWNER_ACCOUNTS.slice(1),
				card("cc-1", "1111", 5770, 5000),
				...OWNER_CARDS.slice(1),
			],
			bills: { "cc-1": [bill("bill-a", { totalAmount: 600, payments: [] })] },
		});
		t.setNow(LATER);
		await t.run();
		expect(await byName(t.stores, "Mercado Pago")).toMatchObject({ balanceCents: -1_250 });
		expect(await byLast4(t.stores, "1111")).toMatchObject({ availableCents: 500_000 });
		const bill_a = await t.stores.bills.findByExternal("pluggy", "bill-a");
		expect(bill_a).toMatchObject({ totalAmountCents: 60_000, payments: [], syncedAt: LATER });
		// Fatura que o Pluggy não devolveu mais continua gravada como estava.
		expect((await t.stores.bills.findByExternal("pluggy", "bill-b"))?.syncedAt).toEqual(NOW);
	});

	it("ausência mantém o último valor: saldo, disponível e faturas não são zerados", async () => {
		await t.run();
		t.change({
			accounts: [
				bank("ba-mp", "Mercado Pago", null),
				...OWNER_ACCOUNTS.slice(1),
				card("cc-1", "1111", 5770, null),
				card("cc-2", "2222", 2900, undefined),
				...OWNER_CARDS.slice(2),
			],
			// Sem `bills` o fake responde 404 (conector sem faturas).
		});
		t.setNow(LATER);
		const result = await t.run();
		expect(result.status).toBe("ok");
		expect(await byName(t.stores, "Mercado Pago")).toMatchObject({
			balanceCents: 20_535,
			balanceSyncedAt: NOW,
		});
		expect(await byLast4(t.stores, "1111")).toMatchObject({ availableCents: 523_267, limitSyncedAt: NOW });
		expect(await byLast4(t.stores, "2222")).toMatchObject({ availableCents: 256_144, limitSyncedAt: NOW });
		// O cartão que continuou informando ganhou o instante novo.
		expect(await byLast4(t.stores, "3333")).toMatchObject({ availableCents: 535_100, limitSyncedAt: LATER });
		expect(await t.stores.bills.list()).toHaveLength(3);
		expect((await t.stores.bills.list()).every((b) => b.syncedAt.getTime() === NOW.getTime())).toBe(true);
	});

	it("saldo do cartão ausente numa rodada em que o disponível veio grava null (não mantém o da rodada anterior)", async () => {
		await t.run();
		expect((await byLast4(t.stores, "1111"))?.balanceCents).not.toBeNull();
		t.change({
			accounts: [
				...OWNER_ACCOUNTS.slice(0, 1),
				{ ...card("cc-1", "1111", 5770, 5000), balance: null },
				...OWNER_CARDS.slice(1),
			],
		});
		t.setNow(LATER);
		await t.run();
		expect(await byLast4(t.stores, "1111")).toMatchObject({ availableCents: 500_000, balanceCents: null });
	});

	it("dado ruim não quebra a sincronização: fatura sem total ou outra moeda fica de fora", async () => {
		t.change({
			accounts: [bank("ba-mp", "Mercado Pago", "abc"), card("cc-1", "1111", 5770, { x: 1 } as never)],
			bills: {
				"cc-1": [
					bill("ok", { totalAmount: 10 }),
					bill("sem-total", { totalAmount: null }),
					bill("sem-vencimento", { dueDate: null }),
					bill("dolar", { totalAmountCurrencyCode: "USD" }),
					bill("pagto-ruim", {
						minimumPaymentAmount: "lixo",
						payments: [
							{ paymentDate: "2026-11-01T00:00:00.000Z", amount: 5, currencyCode: "USD" },
							{ paymentDate: "2026-11-02T00:00:00.000Z", amount: 7.5 },
						],
					}),
				],
			},
		});
		const result = await t.run();
		expect(result.status).toBe("ok");
		const c1 = await byLast4(t.stores, "1111");
		expect((await t.stores.bills.listByCard(c1.id)).map((b) => b.externalId).sort()).toEqual([
			"ok",
			"pagto-ruim",
		]);
		const ruim = await t.stores.bills.findByExternal("pluggy", "pagto-ruim");
		expect(ruim).toMatchObject({
			minimumPaymentCents: null,
			payments: [{ externalId: null, amountCents: 750, date: "2026-11-02" }],
		});
		expect(await byName(t.stores, "Mercado Pago")).toMatchObject({
			balanceCents: null,
			balanceSyncedAt: null,
		});
		expect(c1).toMatchObject({ availableCents: null, limitSyncedAt: null });
		expect(result.connections[0]?.bankNumbers).toMatchObject({ bills: 2, skippedBills: 3 });
	});
});

describe("leitura dos campos novos (schemas)", () => {
	it("balance e availableCreditLimit são tolerantes", () => {
		const base = { id: "a", type: "BANK", name: "x" };
		expect(accountSchema.parse({ ...base, balance: 10.5 }).balance).toBe(10.5);
		expect(accountSchema.parse({ ...base, balance: null }).balance).toBeNull();
		expect(accountSchema.parse(base).balance).toBeUndefined();
		expect(accountSchema.parse({ ...base, balance: "lixo" }).balance).toBeNull();
		expect(
			accountSchema.parse({ ...base, creditData: { availableCreditLimit: [] } }).creditData
				?.availableCreditLimit,
		).toBeNull();
	});

	it("bill lê mínimo, moeda e id do pagamento; ausentes não quebram", () => {
		const parsed = billSchema.parse({
			id: "b",
			dueDate: "2026-11-17",
			totalAmount: 10,
			minimumPaymentAmount: 2,
			payments: [
				{ id: "p", paymentDate: "2026-11-01", amount: 1 },
				{ paymentDate: "2026-11-02", amount: 2 },
			],
		});
		expect(parsed.minimumPaymentAmount).toBe(2);
		expect(parsed.payments.map((p) => p.id ?? null)).toEqual(["p", null]);
		expect(billSchema.parse({ id: "b" }).payments).toEqual([]);
	});

	it("signedCentsOrNull nunca devolve float e aceita negativo", () => {
		expect(signedCentsOrNull(5232.67)).toBe(523_267);
		expect(signedCentsOrNull(-12.5)).toBe(-1_250);
		expect(signedCentsOrNull("205.35")).toBe(20_535);
		expect(signedCentsOrNull(0)).toBe(0);
		expect(signedCentsOrNull(null)).toBeNull();
		expect(signedCentsOrNull(undefined)).toBeNull();
		expect(signedCentsOrNull("x")).toBeNull();
		expect(signedCentsOrNull(1e11)).toBeNull();
	});
});
