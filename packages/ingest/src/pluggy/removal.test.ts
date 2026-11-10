import { createMemoryStores, type Stores } from "@orbita/db";
import { PLUGGY_MISSING_PREFIX, PLUGGY_REMOVED_PREFIX } from "@orbita/shared";
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
import { removePluggyConnection } from "./removal.ts";
import { syncPluggy } from "./sync.ts";

/*
 * Conexão removida (no app ou no meu.pluggy.ai): contas e cartões dela saem de saldo, limites e contagens
 * (arquivados), os lançamentos já importados ficam e reconectar religa sem duplicar.
 */

const NOW = new Date("2026-11-12T09:00:00Z");
const SECRETS: Record<string, string | null> = {
	pluggy_client_id: CLIENT_ID,
	pluggy_client_secret: CLIENT_SECRET,
};
// O segundo banco (outro item) e o item novo de uma reconexão do primeiro.
const ITEM_B = "9a8b7c6d-1111-4222-8333-444455556666";
const B_ACCOUNT = "0f1d2c3b-aaaa-4bbb-8ccc-0000000000b1";
const NEW_ITEM = "5a8b7c6d-1111-4222-8333-444455556677";
const NEW_BANK = "0f1d2c3b-aaaa-4bbb-8ccc-0000000000a1";
const NEW_CARD = "0f1d2c3b-aaaa-4bbb-8ccc-0000000000a2";

const accountB = {
	...bankAccount,
	id: B_ACCOUNT,
	itemId: ITEM_B,
	name: "Conta Poupança Azul",
	number: "99999-9",
	balance: 100,
	bankData: { transferNumber: "0001/99999-9" },
};
const txs = (prefix: string) => [
	tx(`${prefix}-b1`, { description: "Mercado", amount: -152.37, date: "2026-11-03T00:00:00.000Z" }),
];
const cardTxs = (prefix: string) => [
	tx(`${prefix}-c1`, { description: "Livraria", amount: 100.1, date: "2026-11-09T00:00:00.000Z" }),
];
const bills = (id: string) => ({
	[id]: [{ id: "bill-nov", dueDate: "2026-11-17T00:00:00.000Z", totalAmount: 100.1, payments: [] }],
});

function world() {
	const stores = createMemoryStores({ now: () => NOW });
	const run = (options: FakePluggyOptions = {}, sync: { connectionIds?: readonly string[] } = {}) => {
		const fake = fakePluggy({
			otherItems: { [ITEM_B]: { accounts: [accountB] } },
			bills: { ...bills(CARD_ACCOUNT_ID), ...bills(NEW_CARD) },
			transactions: {
				[BANK_ACCOUNT_ID]: txs("old"),
				[CARD_ACCOUNT_ID]: cardTxs("old"),
				[B_ACCOUNT]: txs("b"),
			},
			...options,
		});
		return syncPluggy(
			{ stores, readSecret: async (n) => SECRETS[n] ?? null, fetch: fake.fetch, now: () => NOW },
			sync,
		);
	};
	return { stores, run };
}

async function imported() {
	const w = world();
	await w.stores.pluggyConnections.add({ id: ITEM_ID, label: "Itaú" });
	await w.stores.pluggyConnections.add({ id: ITEM_B, label: "Azul" });
	const first = await w.run();
	expect(first.status).toBe("ok");
	return w;
}

const names = async (s: Stores) => (await s.accounts.list()).map((a) => a.name).sort();
const history = (s: Stores) => s.transactions.listRecent({ limit: 100 });
const gone404 =
	(id: string): NonNullable<FakePluggyOptions["override"]> =>
	(url) =>
		url.pathname === `/items/${id}`
			? new Response(JSON.stringify({ message: "Item not found" }), { status: 404 })
			: undefined;

describe("conexão removida pelo app", () => {
	it("arquiva contas e cartões dela, mantém os lançamentos e não mexe nas outras conexões", async () => {
		const w = await imported();
		const before = await history(w.stores);
		expect(await w.stores.accounts.list()).toHaveLength(2);
		expect(await w.stores.cards.list()).toHaveLength(1);

		const done = await removePluggyConnection(w.stores, ITEM_ID);
		expect(done).toEqual({ removed: true, accounts: 1, cards: 1 });

		expect(await names(w.stores)).toEqual(["Conta Poupança Azul"]);
		expect(await w.stores.cards.list()).toEqual([]);
		// Os lançamentos continuam, e a conta arquivada segue legível pelo id (o histórico precisa do nome).
		expect(await history(w.stores)).toHaveLength(before.length);
		const archived = await w.stores.accounts.findByExternal("pluggy", BANK_ACCOUNT_ID);
		expect(archived?.archivedAt).toBeInstanceOf(Date);
		expect(await w.stores.accounts.get(archived?.id ?? "")).not.toBeNull();
		// Repetir não faz nada.
		expect(await removePluggyConnection(w.stores, ITEM_ID)).toEqual({
			removed: false,
			accounts: 0,
			cards: 0,
		});
	});

	it("a rodada seguinte não traz a conta de volta nem duplica", async () => {
		const w = await imported();
		await removePluggyConnection(w.stores, ITEM_ID);
		await w.run();
		expect(await names(w.stores)).toEqual(["Conta Poupança Azul"]);
		expect(await w.stores.cards.list()).toEqual([]);
	});

	it("reconectar o banco (item novo, ids novos) religa a conta arquivada, sem duplicar", async () => {
		const w = await imported();
		const before = await history(w.stores);
		const oldAccount = await w.stores.accounts.findByExternal("pluggy", BANK_ACCOUNT_ID);
		const oldCard = await w.stores.cards.findByExternal("pluggy", CARD_ACCOUNT_ID);
		await removePluggyConnection(w.stores, ITEM_ID);

		await w.stores.pluggyConnections.add({ id: NEW_ITEM, label: "Itaú" });
		const result = await w.run({
			otherItems: {
				[ITEM_B]: { accounts: [accountB] },
				[NEW_ITEM]: {
					accounts: [
						{ ...bankAccount, id: NEW_BANK, itemId: NEW_ITEM },
						{ ...cardAccount, id: NEW_CARD, itemId: NEW_ITEM },
					],
					item: { connector: { id: 612, name: "Nubank", isSandbox: false } },
				},
			},
			transactions: {
				[B_ACCOUNT]: txs("b"),
				[NEW_BANK]: txs("new"),
				[NEW_CARD]: cardTxs("new"),
			},
		});
		expect(result.connections.find((c) => c.id === NEW_ITEM)?.status).toBe("ok");

		const accounts = await w.stores.accounts.list();
		expect(accounts).toHaveLength(2);
		expect(accounts.map((a) => a.name)).toContain(oldAccount?.name);
		expect(accounts.find((a) => a.id === oldAccount?.id)).toMatchObject({
			externalId: NEW_BANK,
			archivedAt: null,
			archiveReason: null,
			connectionId: NEW_ITEM,
		});
		const cards = await w.stores.cards.list();
		expect(cards.map((c) => c.id)).toEqual([oldCard?.id]);
		expect(cards[0]?.externalId).toBe(NEW_CARD);
		// Nada duplicou: os lançamentos do item antigo foram religados.
		expect(await history(w.stores)).toHaveLength(before.length);
	});

	it("reconectar o mesmo item desarquiva as contas dele", async () => {
		const w = await imported();
		await removePluggyConnection(w.stores, ITEM_ID);
		await w.stores.pluggyConnections.add({ id: ITEM_ID, label: "Itaú" });
		await w.run();
		expect(await w.stores.accounts.list()).toHaveLength(2);
		expect(await w.stores.cards.list()).toHaveLength(1);
		expect((await history(w.stores)).length).toBeGreaterThan(0);
	});

	it("conta que o dono arquivou não volta ao reconectar", async () => {
		const w = await imported();
		const acc = await w.stores.accounts.findByExternal("pluggy", BANK_ACCOUNT_ID);
		await w.stores.accounts.archive(acc?.id ?? "");
		await w.run();
		expect(await names(w.stores)).toEqual(["Conta Poupança Azul"]);
	});
});

describe("item removido no Meu Pluggy (404)", () => {
	it("o primeiro 404 só avisa; o segundo seguido, com outro item respondendo, arquiva e mantém os lançamentos", async () => {
		const w = await imported();
		const before = await history(w.stores);

		const first = await w.run({ override: gone404(ITEM_ID) });
		expect(first.connections.find((c) => c.id === ITEM_ID)?.removedAtSource).toBeUndefined();
		const once = await w.stores.pluggyConnections.get(ITEM_ID);
		expect(once?.lastStatus).toBe("error");
		expect(once?.lastError?.startsWith(PLUGGY_MISSING_PREFIX)).toBe(true);
		expect(await w.stores.accounts.list()).toHaveLength(2);
		expect(await w.stores.cards.list()).toHaveLength(1);

		const second = await w.run({ override: gone404(ITEM_ID) });
		expect(second.connections.find((c) => c.id === ITEM_ID)).toMatchObject({
			status: "error",
			removedAtSource: true,
		});
		const conn = await w.stores.pluggyConnections.get(ITEM_ID);
		expect(conn?.lastError?.startsWith(PLUGGY_REMOVED_PREFIX)).toBe(true);
		expect(conn).toMatchObject({ accountCount: 0, cardCount: 0 });
		expect(await names(w.stores)).toEqual(["Conta Poupança Azul"]);
		expect(await w.stores.cards.list()).toEqual([]);
		expect(await history(w.stores)).toHaveLength(before.length);
		expect(second.connections.find((c) => c.id === ITEM_B)?.status).toBe("ok");
	});

	it("chave errada (todos os itens dão 404) nunca arquiva, nem em rodadas seguidas", async () => {
		const w = await imported();
		const all404: NonNullable<FakePluggyOptions["override"]> = (url) =>
			url.pathname.startsWith("/items/")
				? new Response(JSON.stringify({ message: "Item not found" }), { status: 404 })
				: undefined;
		for (let i = 0; i < 3; i++) await w.run({ override: all404 });
		expect(await w.stores.accounts.list()).toHaveLength(2);
		expect(await w.stores.cards.list()).toHaveLength(1);
	});

	it("um 404 isolado, seguido de resposta normal, não deixa rastro: o próximo 404 volta a ser o primeiro", async () => {
		const w = await imported();
		await w.run({ override: gone404(ITEM_ID) });
		await w.run();
		await w.run({ override: gone404(ITEM_ID) });
		expect(await w.stores.accounts.list()).toHaveLength(2);
	});

	it("o item que volta (mesmo id) desarquiva", async () => {
		const w = await imported();
		await w.run({ override: gone404(ITEM_ID) });
		await w.run({ override: gone404(ITEM_ID) });
		expect(await w.stores.accounts.list()).toHaveLength(1);
		await w.run();
		expect(await w.stores.accounts.list()).toHaveLength(2);
		expect(await w.stores.cards.list()).toHaveLength(1);
		expect((await w.stores.pluggyConnections.get(ITEM_ID))?.lastStatus).toBe("ok");
	});

	it("conexão que nunca sincronizou não vira 'removida': é id errado", async () => {
		const w = world();
		await w.stores.pluggyConnections.add({ id: ITEM_ID });
		const result = await w.run({ override: gone404(ITEM_ID) });
		expect(result.connections[0]?.removedAtSource).toBeUndefined();
		expect(result.connections[0]?.status).toBe("error");
		expect(result.connections[0]?.error?.startsWith(PLUGGY_MISSING_PREFIX)).toBe(false);
	});
});

describe("remoção no meio da rodada (DELETE × sync)", () => {
	it("a conexão removida no meio da rodada tem as contas arquivadas ao fim dela", async () => {
		const w = await imported();
		let removed = false;
		await w.run({
			override: (url) => {
				if (url.pathname === "/v2/transactions" && !removed) {
					removed = true;
					void w.stores.pluggyConnections.remove(ITEM_ID);
				}
				return undefined;
			},
		});
		expect((await w.stores.accounts.list()).map((a) => a.externalId)).toEqual([B_ACCOUNT]);
		expect(await w.stores.cards.list()).toEqual([]);
	});
});

describe("dados de antes do vínculo (sem connectionId)", () => {
	async function legacy() {
		const w = world();
		// Como estava gravado antes: contas do Pluggy sem a conexão de origem, de duas conexões; só a B ainda existe.
		const mk = (name: string, externalId: string) =>
			w.stores.accounts.create({ name, kind: "checking", source: "pluggy", externalId });
		await mk("Itaú · Conta corrente", "removida-na-pluggy");
		await mk("Conta Poupança Azul", B_ACCOUNT);
		await w.stores.cards.create({
			name: "Cartão antigo",
			closingDay: 10,
			dueDay: 17,
			source: "pluggy",
			externalId: CARD_ACCOUNT_ID,
		});
		await w.stores.pluggyConnections.add({ id: ITEM_B, label: "Azul" });
		return w;
	}

	it("só arquiva a conta legada depois de DUAS sincronizações completas sem ela em nenhuma conexão viva", async () => {
		const w = await legacy();
		await w.run();
		expect(await w.stores.accounts.list()).toHaveLength(2);
		expect((await w.stores.accounts.findByExternal("pluggy", B_ACCOUNT))?.connectionId).toBe(ITEM_B);
		await w.run();
		expect(await names(w.stores)).toEqual(["Conta Poupança Azul"]);
		// O cartão legado também (nenhuma conexão viva o traz).
		expect(await w.stores.cards.list()).toEqual([]);
		// Idempotente.
		await w.run();
		expect(await names(w.stores)).toEqual(["Conta Poupança Azul"]);
	});

	it("conta legada que a conexão viva deixou de listar uma vez e voltou na rodada seguinte fica viva", async () => {
		const w = await legacy();
		await w.stores.accounts.create({
			name: "Conta Corrente",
			kind: "checking",
			source: "pluggy",
			externalId: BANK_ACCOUNT_ID,
		});
		await w.stores.pluggyConnections.add({ id: ITEM_ID });
		await w.run({ accounts: [] });
		await w.run();
		await w.run();
		await w.run();
		const kept = await w.stores.accounts.findByExternal("pluggy", BANK_ACCOUNT_ID);
		expect(kept).toMatchObject({ archivedAt: null, connectionId: ITEM_ID });
		expect((await w.stores.cards.list()).map((c) => c.externalId)).toEqual([CARD_ACCOUNT_ID]);
	});

	it("sem nenhuma conexão cadastrada, arquiva tudo que veio do Pluggy e deixa a conta manual", async () => {
		const w = await legacy();
		await w.stores.accounts.create({ name: "Carteira", kind: "wallet" });
		await w.stores.pluggyConnections.remove(ITEM_B);
		expect((await w.run()).status).toBe("no_connections");
		expect(await names(w.stores)).toEqual(["Carteira"]);
	});

	it("rodada de uma conexão só (nova tentativa) não conta ausência", async () => {
		const w = await legacy();
		for (let i = 0; i < 3; i++) await w.run({}, { connectionIds: [ITEM_B] });
		expect(await w.stores.accounts.list()).toHaveLength(2);
	});

	const ITEM_C = "7c7c7c7c-1111-4222-8333-444455557777";
	it("conexão que nunca teve conta (só investimento) não bloqueia: a legada some em duas rodadas", async () => {
		const w = await legacy();
		await w.stores.pluggyConnections.add({ id: ITEM_C, label: "C6" });
		const options: FakePluggyOptions = {
			otherItems: { [ITEM_B]: { accounts: [accountB] }, [ITEM_C]: { accounts: [] } },
		};
		await w.run(options);
		expect(await w.stores.accounts.list()).toHaveLength(2);
		await w.run(options);
		expect(await names(w.stores)).toEqual(["Conta Poupança Azul"]);
	});

	it("o mesmo, mas a conexão sem contas já teve conta antes: bloqueia e nada legado é arquivado", async () => {
		const w = await legacy();
		await w.stores.pluggyConnections.add({ id: ITEM_C, label: "C6" });
		await w.stores.pluggyConnections.recordSync(ITEM_C, { status: "ok", counts: { accounts: 1, cards: 0 } });
		const options: FakePluggyOptions = {
			otherItems: { [ITEM_B]: { accounts: [accountB] }, [ITEM_C]: { accounts: [] } },
		};
		for (let i = 0; i < 4; i++) await w.run(options);
		expect((await w.stores.accounts.list()).map((a) => a.externalId)).toContain("removida-na-pluggy");
	});

	// Nenhuma destas rodadas prova que a conta legada sumiu: nada legado pode ser arquivado, por mais rodadas que haja.
	const badRounds: Array<[string, FakePluggyOptions]> = [
		[
			"outra conexão com erro de rede",
			{
				override: (u) =>
					u.pathname === "/accounts" && u.searchParams.get("itemId") === ITEM_ID
						? new Response("{}", { status: 500 })
						: undefined,
			},
		],
		["outra conexão pedindo login", { item: { status: "LOGIN_ERROR" } }],
		["outra conexão atualizando (UPDATING)", { item: { status: "UPDATING" } }],
		["outra conexão com /accounts vazio", { accounts: [] }],
		["conta fora do formato (dropped)", { accounts: [bankAccount, { id: CARD_ACCOUNT_ID, name: 5 }] }],
		[
			"cartão adiado (faturas falham, sem datas)",
			{
				bills: {},
				override: (u) => (u.pathname === "/bills" ? new Response("{}", { status: 500 }) : undefined),
				accounts: [
					{
						...cardAccount,
						id: "0f1d2c3b-aaaa-4bbb-8ccc-0000000000c9",
						creditData: { ...cardAccount.creditData, balanceCloseDate: null, balanceDueDate: null },
					},
				],
			},
		],
	];
	it.each(badRounds)("%s: nada legado é arquivado", async (_name, options) => {
		const w = await legacy();
		await w.stores.pluggyConnections.add({ id: ITEM_ID });
		// A conexão já teve conta: se agora vem vazia, pode ser falha passageira, então bloqueia.
		await w.stores.pluggyConnections.recordSync(ITEM_ID, { status: "ok", counts: { accounts: 1, cards: 0 } });
		for (let i = 0; i < 4; i++) await w.run(options);
		const live = (await w.stores.accounts.list()).map((a) => a.externalId);
		expect(live).toContain("removida-na-pluggy");
		expect(live).toContain(B_ACCOUNT);
		expect((await w.stores.cards.list()).map((c) => c.externalId)).toEqual([CARD_ACCOUNT_ID]);
	});
});
