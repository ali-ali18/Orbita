import { createMemoryStores, type Stores } from "@orbita/db";
import { describe, expect, it } from "vitest";
import {
	BANK_ACCOUNT_ID,
	bankAccount,
	CARD_ACCOUNT_ID,
	CLIENT_ID,
	CLIENT_SECRET,
	cardAccount,
	type FakePluggyOptions,
	fakePluggy,
	ITEM_ID,
	tx,
} from "./fake-pluggy.ts";
import { syncPluggy } from "./sync.ts";

/*
 * Rede de segurança da reconexão: chega um item NOVO do mesmo banco (ids de conta e de lançamento do Pluggy são por
 * item). Contas, cartões e lançamentos do item antigo têm de ser religados em vez de duplicados.
 */

const NOW = new Date("2026-11-12T09:00:00Z");
const NEW_ITEM = "9a8b7c6d-1111-4222-8333-444455556666";
const NEW_BANK = "0f1d2c3b-aaaa-4bbb-8ccc-0000000000a1";
const NEW_CARD = "0f1d2c3b-aaaa-4bbb-8ccc-0000000000a2";
const SECRETS: Record<string, string | null> = {
	pluggy_client_id: CLIENT_ID,
	pluggy_client_secret: CLIENT_SECRET,
};
const NUBANK = { id: 612, name: "Nubank", isSandbox: false };
const ITAU = { id: 201, name: "Itaú", isSandbox: false };

/** Os mesmos lançamentos com ids de outro item. */
const bankTxs = (prefix: string) => [
	tx(`${prefix}-b1`, { description: "Mercado", amount: -152.37, date: "2026-11-03T00:00:00.000Z" }),
	tx(`${prefix}-b2`, {
		description: "Salário",
		type: "CREDIT",
		amount: 4500,
		date: "2026-11-05T00:00:00.000Z",
		category: "Salary",
	}),
];
const cardTxs = (prefix: string) => [
	tx(`${prefix}-c1`, { description: "Livraria", amount: 100.1, date: "2026-11-09T00:00:00.000Z" }),
	tx(`${prefix}-c2`, {
		description: "Geladeira",
		amount: 250,
		date: "2026-10-20T00:00:00.000Z",
		creditCardMetadata: {
			installmentNumber: 2,
			totalInstallments: 6,
			billId: "bill-1",
			purchaseDate: "2026-09-20T00:00:00.000Z",
		},
	}),
];
const bills = (accountId: string) => ({
	[accountId]: [{ id: "bill-nov", dueDate: "2026-11-17T00:00:00.000Z", totalAmount: 350.1, payments: [] }],
});

const renamed = (account: object, id: string, itemId: string) => ({ ...account, id, itemId });

function world() {
	const stores = createMemoryStores({ now: () => NOW });
	const run = (options: FakePluggyOptions, sync: { connectionIds?: readonly string[] } = {}) => {
		const fake = fakePluggy({ bills: { ...bills(CARD_ACCOUNT_ID), ...bills(NEW_CARD) }, ...options });
		return syncPluggy(
			{
				stores,
				readSecret: async (n) => SECRETS[n] ?? null,
				fetch: fake.fetch,
				now: () => NOW,
			},
			sync,
		);
	};
	return { stores, run };
}

/** Primeira rodada: o item antigo (ITEM_ID), com tudo importado. */
async function importOld(w: ReturnType<typeof world>) {
	await w.stores.pluggyConnections.add({ id: ITEM_ID, label: "Nubank" });
	await w.run({
		transactions: { [BANK_ACCOUNT_ID]: bankTxs("old"), [CARD_ACCOUNT_ID]: cardTxs("old") },
	});
}

/**
 * Segunda rodada, depois de entrar no banco de novo SEM modo de atualização: o item antigo pede login e o item novo
 * traz as mesmas contas com outros ids.
 */
function reconnected(
	extra: Partial<FakePluggyOptions> = {},
	newConnector: object = NUBANK,
): FakePluggyOptions {
	return {
		item: { status: "LOGIN_ERROR" },
		otherItems: {
			[NEW_ITEM]: {
				accounts: [renamed(bankAccount, NEW_BANK, NEW_ITEM), renamed(cardAccount, NEW_CARD, NEW_ITEM)],
				item: { connector: newConnector },
			},
		},
		transactions: {
			[BANK_ACCOUNT_ID]: bankTxs("old"),
			[CARD_ACCOUNT_ID]: cardTxs("old"),
			[NEW_BANK]: bankTxs("new"),
			[NEW_CARD]: cardTxs("new"),
		},
		...extra,
	};
}

const all = (stores: Stores) => stores.transactions.listRecent({ limit: 100 });

describe("item novo do mesmo banco (reconexão fora do modo de atualização)", () => {
	it("religa conta e cartão, troca os ids dos lançamentos e não duplica nada", async () => {
		const w = world();
		await importOld(w);
		const before = await all(w.stores);
		const accountsBefore = await w.stores.accounts.list();
		const cardsBefore = await w.stores.cards.list();
		expect(before.length).toBeGreaterThan(0);

		await w.stores.pluggyConnections.add({ id: NEW_ITEM });
		const result = await w.run(reconnected());
		const mine = result.connections.find((c) => c.id === NEW_ITEM);
		expect(mine?.status).toBe("ok");

		// Mesmas contas e cartões (mesmos ids do Órbita), agora apontando para o item novo.
		expect((await w.stores.accounts.list()).map((a) => a.id)).toEqual(accountsBefore.map((a) => a.id));
		expect((await w.stores.cards.list()).map((c) => c.id)).toEqual(cardsBefore.map((c) => c.id));
		expect((await w.stores.accounts.list())[0]?.externalId).toBe(NEW_BANK);
		expect((await w.stores.cards.list())[0]?.externalId).toBe(NEW_CARD);

		// Nenhum lançamento a mais, e todos já levam o id novo.
		const after = await all(w.stores);
		expect(after).toHaveLength(before.length);
		expect(after.map((t) => t.id).sort()).toEqual(before.map((t) => t.id).sort());
		expect(after.every((t) => t.externalId?.startsWith("new-"))).toBe(true);
		expect(mine?.created).toBe(0);
		expect(mine?.rekeyed).toBe(before.length);
		expect(mine?.relinkedAccounts).toBe(2);

		// A conexão antiga (parada) sai da lista; a nova fica.
		expect((await w.stores.pluggyConnections.list()).map((c) => c.id)).toEqual([NEW_ITEM]);
		expect(mine?.notes.join(" ")).toContain("foi arquivada");
	});

	it("sincronizar de novo é idempotente", async () => {
		const w = world();
		await importOld(w);
		await w.stores.pluggyConnections.add({ id: NEW_ITEM });
		await w.run(reconnected());
		const first = await all(w.stores);
		const again = await w.run(reconnected());
		expect(again.connections.every((c) => c.status === "ok")).toBe(true);
		expect(await all(w.stores)).toEqual(first);
		expect(await w.stores.accounts.list()).toHaveLength(1);
		expect(await w.stores.cards.list()).toHaveLength(1);
	});

	it("preserva o que o dono editou no lançamento religado", async () => {
		const w = world();
		await importOld(w);
		const mercado = (await all(w.stores)).find((t) => t.description === "Mercado");
		await w.stores.transactions.update(mercado?.id as string, { note: "feira do mês" });
		await w.stores.pluggyConnections.add({ id: NEW_ITEM });
		await w.run(reconnected());
		expect(await w.stores.transactions.get(mercado?.id as string)).toMatchObject({
			note: "feira do mês",
			externalId: "new-b1",
		});
	});

	it("banco diferente não religa: nasce conta e cartão novos", async () => {
		const w = world();
		await importOld(w);
		await w.stores.pluggyConnections.add({ id: NEW_ITEM });
		const result = await w.run(reconnected({}, ITAU));
		expect(result.connections.find((c) => c.id === NEW_ITEM)?.relinkedAccounts).toBeUndefined();
		expect(await w.stores.accounts.list()).toHaveLength(2);
		expect(await w.stores.cards.list()).toHaveLength(2);
		// A conexão antiga não é arquivada: é de outro banco.
		expect((await w.stores.pluggyConnections.list()).map((c) => c.id).sort()).toEqual(
			[ITEM_ID, NEW_ITEM].sort(),
		);
		expect((await all(w.stores)).length).toBe(8);
	});

	it("outra conexão ainda viva (segundo login do mesmo banco) não perde as contas", async () => {
		const w = world();
		await importOld(w);
		await w.stores.pluggyConnections.add({ id: NEW_ITEM });
		// O item antigo segue UPDATED e ainda tem as contas dele: o novo é outra conta de verdade.
		const result = await w.run(reconnected({ item: { status: "UPDATED" } }));
		expect(result.connections.find((c) => c.id === NEW_ITEM)?.relinkedAccounts).toBeUndefined();
		expect(await w.stores.accounts.list()).toHaveLength(2);
		expect(await w.stores.cards.list()).toHaveLength(2);
		expect((await w.stores.pluggyConnections.list()).map((c) => c.id).sort()).toEqual(
			[ITEM_ID, NEW_ITEM].sort(),
		);
	});

	it("nova tentativa só da conexão nova: a conta mantida pela outra conexão viva não é roubada", async () => {
		const w = world();
		await importOld(w);
		await w.stores.pluggyConnections.add({ id: NEW_ITEM });
		const result = await w.run(reconnected({ item: { status: "UPDATED" } }), { connectionIds: [NEW_ITEM] });
		expect(result.connections.map((c) => c.id)).toEqual([NEW_ITEM]);
		expect(result.connections[0]?.relinkedAccounts).toBeUndefined();
		const accounts = await w.stores.accounts.list();
		expect(accounts).toHaveLength(2);
		expect(accounts.map((a) => a.externalId).sort()).toEqual([BANK_ACCOUNT_ID, NEW_BANK].sort());
		expect(await w.stores.cards.list()).toHaveLength(2);
		// O sync completo seguinte fica igual: nada migrou nem duplicou.
		const afterRetry = (await all(w.stores)).length;
		await w.run(reconnected({ item: { status: "UPDATED" } }));
		expect(await w.stores.accounts.list()).toHaveLength(2);
		expect((await all(w.stores)).length).toBe(afterRetry);
	});

	it("o mesmo retry, com a conexão antiga parada, ainda religa (a conferência vê as outras)", async () => {
		const w = world();
		await importOld(w);
		await w.stores.pluggyConnections.add({ id: NEW_ITEM });
		const result = await w.run(reconnected(), { connectionIds: [NEW_ITEM] });
		expect(result.connections[0]?.relinkedAccounts).toBe(2);
		expect(await w.stores.accounts.list()).toHaveLength(1);
	});

	it("não consegue conferir a outra conexão: espera a próxima rodada em vez de duplicar", async () => {
		const w = world();
		await importOld(w);
		await w.stores.pluggyConnections.add({ id: NEW_ITEM });
		const result = await w.run(
			reconnected({
				// Falha passageira só ao olhar a conexão antiga, a segunda vez que ela é consultada.
				override: (() => {
					let item = 0;
					return (url: URL) => {
						if (url.pathname === `/items/${ITEM_ID}` && ++item > 1) {
							return new Response("{}", { status: 500 });
						}
						return undefined;
					};
				})(),
			}),
		);
		const mine = result.connections.find((c) => c.id === NEW_ITEM);
		expect(mine?.status).toBe("partial");
		expect(await w.stores.accounts.list()).toHaveLength(1);
		expect(await w.stores.cards.list()).toHaveLength(1);
		expect(mine?.notes.join(" ")).toContain("ainda não foi ligada");
		// Na rodada seguinte tudo se resolve.
		const next = await w.run(reconnected());
		expect(next.connections.find((c) => c.id === NEW_ITEM)?.status).toBe("ok");
		expect((await w.stores.accounts.list())[0]?.externalId).toBe(NEW_BANK);
	});

	it("dois lançamentos iguais no antigo e um só no novo: não adota, grava para revisão", async () => {
		const w = world();
		await w.stores.pluggyConnections.add({ id: ITEM_ID, label: "Nubank" });
		const twins = [
			tx("old-t1", { description: "Café", amount: -9, date: "2026-11-03T00:00:00.000Z" }),
			tx("old-t2", { description: "Café", amount: -9, date: "2026-11-03T00:00:00.000Z" }),
		];
		await w.run({
			transactions: { [BANK_ACCOUNT_ID]: twins, [CARD_ACCOUNT_ID]: [] },
			accounts: [bankAccount, cardAccount],
		});
		await w.stores.pluggyConnections.add({ id: NEW_ITEM });
		const result = await w.run(
			reconnected({
				transactions: {
					[BANK_ACCOUNT_ID]: twins,
					[CARD_ACCOUNT_ID]: [],
					[NEW_BANK]: [tx("new-t1", { description: "Café", amount: -9, date: "2026-11-03T00:00:00.000Z" })],
					[NEW_CARD]: [],
				},
			}),
		);
		const mine = result.connections.find((c) => c.id === NEW_ITEM);
		expect(mine?.rekeyed).toBeUndefined();
		expect(mine?.possibleDuplicates).toBe(1);
		const rows = await all(w.stores);
		expect(rows).toHaveLength(3);
		expect(rows.find((t) => t.externalId === "new-t1")).toMatchObject({ status: "pending" });
	});

	it("dois lançamentos iguais dos dois lados casam um a um", async () => {
		const w = world();
		await w.stores.pluggyConnections.add({ id: ITEM_ID, label: "Nubank" });
		const pair = (p: string) => [
			tx(`${p}-t1`, { description: "Café", amount: -9, date: "2026-11-03T00:00:00.000Z" }),
			tx(`${p}-t2`, { description: "Café", amount: -9, date: "2026-11-03T00:00:00.000Z" }),
		];
		await w.run({ transactions: { [BANK_ACCOUNT_ID]: pair("old"), [CARD_ACCOUNT_ID]: [] } });
		await w.stores.pluggyConnections.add({ id: NEW_ITEM });
		const result = await w.run(
			reconnected({
				transactions: {
					[BANK_ACCOUNT_ID]: pair("old"),
					[NEW_BANK]: pair("new"),
					[NEW_CARD]: [],
					[CARD_ACCOUNT_ID]: [],
				},
			}),
		);
		expect(result.connections.find((c) => c.id === NEW_ITEM)?.rekeyed).toBe(2);
		const rows = await all(w.stores);
		expect(rows.map((t) => t.externalId).sort()).toEqual(["new-t1", "new-t2"]);
	});
});
