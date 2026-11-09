import { createMemoryStores } from "@orbita/db";
import { describe, expect, it } from "vitest";
import { inferClosingRule } from "./closing-rule.ts";
import { CLIENT_ID, CLIENT_SECRET, fakePluggy, tx } from "./fake-pluggy.ts";
import { mapPluggyTransaction, type TransactionContext } from "./mapping.ts";
import { ACCOUNTS, ITEMS, REAL_NOW, realPluggyOptions } from "./real-data.fixture.ts";
import { billSchema, transactionSchema } from "./schemas.ts";
import { syncPluggy } from "./sync.ts";

/* Dados FICTÍCIOS. A regra de fechamento vem dos dados do cartão; sem evidência não se desloca a data de lançamento. */

const bill = (id: string, close: string) =>
	billSchema.parse({
		id,
		dueDate: `${close.slice(0, 8)}15T00:00:00.000Z`,
		billClosingDate: `${close}T00:00:00.000Z`,
		totalAmount: 100,
		payments: [],
	});
const posted = (id: string, billId: string, extra: Record<string, unknown>) =>
	transactionSchema.parse(
		tx(id, { status: "POSTED", creditCardMetadata: { billId, ...extra }, date: "2026-10-12T00:00:00.000Z" }),
	);
const bills = [bill("b-out", "2026-10-10"), bill("b-nov", "2026-11-10")];

describe("inferClosingRule", () => {
	it("compra postada no dia do fechamento e dentro da fatura que fecha: closing-day-included", () => {
		const txs = [posted("a", "b-out", { billPostDate: "2026-10-10T00:00:00.000Z" })];
		expect(inferClosingRule(txs, bills)).toBe("closing-day-included");
	});

	it("compra postada no dia do fechamento da anterior e na fatura seguinte: closing-day-next", () => {
		const txs = [posted("a", "b-nov", { billPostDate: "2026-10-10T00:00:00.000Z" })];
		expect(inferClosingRule(txs, bills)).toBe("closing-day-next");
	});

	it("sem evidência (nenhuma compra no dia do fechamento) ou com empate: null", () => {
		expect(
			inferClosingRule([posted("a", "b-out", { billPostDate: "2026-10-05T00:00:00.000Z" })], bills),
		).toBeNull();
		expect(inferClosingRule([], bills)).toBeNull();
		expect(
			inferClosingRule(
				[
					posted("a", "b-out", { billPostDate: "2026-10-10T00:00:00.000Z" }),
					posted("b", "b-nov", { billPostDate: "2026-10-10T00:00:00.000Z" }),
				],
				bills,
			),
		).toBeNull();
	});
});

describe("compra PENDING postada no dia do fechamento", () => {
	const ctx = (closingRule: "closing-day-next" | "closing-day-included"): TransactionContext => ({
		accountType: "CREDIT",
		accountId: null,
		card: { id: "card-1", config: { closingDay: 10, dueDay: 17, closingRule } },
		categoryIds: new Map([["outros", "cat-outros"]]),
	});
	const pending = transactionSchema.parse(
		tx("t-1", {
			status: "PENDING",
			date: "2026-11-02T00:00:00.000Z",
			creditCardMetadata: { billPostDate: "2026-11-10T00:00:00.000Z" },
		}),
	);

	it("sem evidência (regra padrão): não desloca, cai na fatura seguinte", () => {
		expect(mapPluggyTransaction(pending, ctx("closing-day-next"))).toMatchObject({
			input: { invoiceMonth: "2026-12" },
		});
	});

	it("regra incluída (inferida): cai na fatura que fecha", () => {
		expect(mapPluggyTransaction(pending, ctx("closing-day-included"))).toMatchObject({
			input: { invoiceMonth: "2026-11" },
		});
	});
});

describe("sync guarda a regra inferida no cartão", () => {
	it("só o cartão com evidência (Mercado Pago, na fixture) vira closing-day-included", async () => {
		const stores = createMemoryStores({ now: () => REAL_NOW });
		for (const [id, label] of [
			[ITEMS.inter, "Inter"],
			[ITEMS.mp, "Mercado Pago"],
			[ITEMS.santander, "Santander"],
			[ITEMS.nubank, "Nubank"],
		] as const) {
			await stores.pluggyConnections.add({ id, label });
		}
		const { itemId: _itemId, ...options } = realPluggyOptions();
		await syncPluggy({
			stores,
			readSecret: async (name) =>
				({ pluggy_client_id: CLIENT_ID, pluggy_client_secret: CLIENT_SECRET })[name] ?? null,
			fetch: fakePluggy(options).fetch,
			now: () => REAL_NOW,
		});
		const rules = Object.fromEntries((await stores.cards.list()).map((c) => [c.last4, c.closingRule]));
		expect(rules).toEqual({
			"8316": "closing-day-next",
			"7054": "closing-day-included",
			"2689": "closing-day-next",
			"5172": "closing-day-next",
		});
	});

	async function realSync() {
		const stores = createMemoryStores({ now: () => REAL_NOW });
		for (const [id, label] of [
			[ITEMS.inter, "Inter"],
			[ITEMS.mp, "Mercado Pago"],
			[ITEMS.santander, "Santander"],
			[ITEMS.nubank, "Nubank"],
		] as const) {
			await stores.pluggyConnections.add({ id, label });
		}
		const { itemId: _itemId, ...options } = realPluggyOptions();
		const run = () =>
			syncPluggy({
				stores,
				readSecret: async (name) =>
					({ pluggy_client_id: CLIENT_ID, pluggy_client_secret: CLIENT_SECRET })[name] ?? null,
				fetch: fakePluggy(options).fetch,
				now: () => REAL_NOW,
			});
		const card = async (last4: string) => {
			const found = (await stores.cards.list()).find((c) => c.last4 === last4);
			if (!found) throw new Error(`cartão ${last4} não encontrado`);
			return found;
		};
		return { stores, run, card, options };
	}

	it("a regra deduzida fica marcada como inferida; a escolha do dono nunca é sobrescrita", async () => {
		const { stores, run, card } = await realSync();
		await run();
		expect(await card("7054")).toMatchObject({
			closingRule: "closing-day-included",
			closingRuleSource: "inferred",
		});
		expect(await card("8316")).toMatchObject({
			closingRule: "closing-day-next",
			closingRuleSource: "default",
		});
		// O dono escolhe "next" no Mercado Pago (o PATCH de regra sem origem é do dono): a evidência não a muda.
		const mp = await card("7054");
		await stores.cards.update(mp.id, { closingRule: "closing-day-next" });
		expect(await card("7054")).toMatchObject({ closingRule: "closing-day-next", closingRuleSource: "owner" });
		await run();
		expect(await card("7054")).toMatchObject({ closingRule: "closing-day-next", closingRuleSource: "owner" });
	});

	it("regra inferida volta ao padrão quando a evidência passa a dizer 'next'; a do dono não", async () => {
		const { stores, run, card, options } = await realSync();
		await run();
		expect(await card("7054")).toMatchObject({
			closingRule: "closing-day-included",
			closingRuleSource: "inferred",
		});
		// O banco passa a postar, no dia do fechamento de 05/09, duas compras que caíram na fatura seguinte (a de 05/10):
		// com a de 05/10 que já havia, "next" tem 2 contra 1.
		const lateCard = (id: string) =>
			tx(id, {
				description: "Loja Exemplo",
				date: "2026-09-05T00:00:00.000Z",
				status: "POSTED",
				creditCardMetadata: { billId: "bill-mp-a", billPostDate: "2026-09-05T00:00:00.000Z" },
			});
		options.transactions = {
			...options.transactions,
			[ACCOUNTS.mpCard]: [
				...(options.transactions?.[ACCOUNTS.mpCard] ?? []),
				lateCard("mp-late-1"),
				lateCard("mp-late-2"),
			],
		};
		await run();
		expect(await card("7054")).toMatchObject({
			closingRule: "closing-day-next",
			closingRuleSource: "default",
		});
		// A mesma evidência não desfaz a escolha do dono.
		const mp = await card("7054");
		await stores.cards.update(mp.id, { closingRule: "closing-day-included" });
		await run();
		expect(await card("7054")).toMatchObject({
			closingRule: "closing-day-included",
			closingRuleSource: "owner",
		});
	});

	it("mudou a regra: a compra efetivada sem billId e não editada é refeita na fatura certa", async () => {
		const { stores, run, card, options } = await realSync();
		// Compra postada no dia do fechamento de 05/10 do Mercado Pago, sem `billId`: pela regra "included" é da fatura
		// de outubro; pela "next", da de novembro.
		const extra = tx("mp-extra", {
			description: "Loja Exemplo",
			amount: 50,
			date: "2026-10-05T00:00:00.000Z",
			status: "POSTED",
			creditCardMetadata: { billId: null },
		});
		options.transactions = {
			...options.transactions,
			[ACCOUNTS.mpCard]: [...(options.transactions?.[ACCOUNTS.mpCard] ?? []), extra],
		};
		await run();
		const mp = await card("7054");
		const row = async () =>
			(await stores.transactions.listByInvoice(mp.id, "2026-10")).find(
				(t) => t.description === "Loja Exemplo",
			);
		expect(await row()).toBeDefined();
		// Como estava antes da dedução: regra padrão e a compra na fatura de novembro.
		await stores.cards.update(mp.id, { closingRule: "closing-day-next", closingRuleSource: "default" });
		const stored = await row();
		await stores.transactions.update(stored?.id as string, { invoiceMonth: "2026-11" });
		expect(await row()).toBeUndefined();
		await run();
		expect(await card("7054")).toMatchObject({
			closingRule: "closing-day-included",
			closingRuleSource: "inferred",
		});
		expect(await row()).toBeDefined();
	});
});
