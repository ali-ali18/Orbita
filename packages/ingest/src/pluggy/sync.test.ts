import { createMemoryStores, type Stores } from "@orbita/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
	API_KEY,
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
import { type SyncPluggyDeps, syncPluggy } from "./sync.ts";

const NOW = new Date("2026-11-12T09:00:00Z"); // 06:00 em São Paulo
const SECRETS: Record<string, string | null> = {
	pluggy_client_id: CLIENT_ID,
	pluggy_client_secret: CLIENT_SECRET,
};

const bankTxs = [
	tx("b-1", { description: "Mercado", amount: -152.37, date: "2026-11-03T00:00:00.000Z" }),
	tx("b-2", {
		description: "Salário",
		type: "CREDIT",
		amount: 4500,
		date: "2026-11-05T00:00:00.000Z",
		category: "Salary",
	}),
	tx("b-3", { description: "Pix para mim", amount: -300, category: "Same person transfer" }),
	tx("b-4", {
		description: "Fatura Mastercard",
		amount: -830.1,
		date: "2026-11-06T00:00:00.000Z",
		category: "Credit card payment",
	}),
	tx("b-5", { description: "Café", amount: -9, status: "PENDING" }),
];
const cardTxs = [
	tx("c-1", { description: "Livraria", amount: 100.1 + 0.2, date: "2026-11-09T00:00:00.000Z" }),
	tx("c-2", {
		description: "Geladeira",
		amount: 250,
		date: "2026-10-20T00:00:00.000Z",
		creditCardMetadata: { installmentNumber: 2, totalInstallments: 6, billId: "bill-1" },
	}),
	tx("c-3", {
		description: "Pagamento recebido",
		type: "CREDIT",
		amount: 830.1,
		category: "Credit card payment",
	}),
	tx("c-4", { description: "Livraria", type: "CREDIT", amount: -100.3, date: "2026-11-10T00:00:00.000Z" }),
	tx("c-5", {
		description: "Loja que não existe",
		type: "CREDIT",
		amount: -20,
		date: "2026-11-10T00:00:00.000Z",
	}),
];

const bill = (id: string, dueDate: string, totalAmount: number, payments: object[] = []) => ({
	id,
	dueDate,
	totalAmount,
	payments,
});

function setup(options: FakePluggyOptions = {}, secrets = SECRETS) {
	const stores = createMemoryStores({ now: () => NOW });
	const fake = fakePluggy({
		transactions: { [BANK_ACCOUNT_ID]: bankTxs, [CARD_ACCOUNT_ID]: cardTxs },
		// Fatura de novembro: vence 17/11, total R$ 830,10 (o plano B por categoria casa pelo total).
		bills: { [CARD_ACCOUNT_ID]: [bill("bill-nov", "2026-11-17T00:00:00.000Z", 830.1)] },
		...options,
	});
	let clock = NOW;
	const deps = (): SyncPluggyDeps => ({
		stores,
		readSecret: async (name) => secrets[name] ?? null,
		fetch: fake.fetch,
		now: () => clock,
	});
	return { stores, fake, deps, run: () => syncPluggy(deps()), setNow: (d: Date) => (clock = d) };
}

async function everything(stores: Stores) {
	return stores.transactions.listRecent({ limit: 100 });
}

describe("syncPluggy", () => {
	let t: ReturnType<typeof setup>;
	beforeEach(async () => {
		t = setup();
		await t.stores.pluggyConnections.add({ id: ITEM_ID, label: "Nubank" });
	});

	it("cria conta, cartão e lançamentos com valores, tipos e faturas certos", async () => {
		const result = await t.run();
		expect(result.status).toBe("ok");

		const [account] = await t.stores.accounts.list();
		const [card] = await t.stores.cards.list();
		expect(account).toMatchObject({
			name: "Nubank Conta Corrente",
			kind: "checking",
			source: "pluggy",
			externalId: BANK_ACCOUNT_ID,
		});
		expect(card).toMatchObject({
			closingDay: 10,
			dueDay: 17,
			limitCents: 500_000,
			last4: "4321",
			externalId: CARD_ACCOUNT_ID,
		});

		const rows = await everything(t.stores);
		const byExt = Object.fromEntries(rows.map((r) => [r.externalId, r]));
		// b-5 (pendente) e c-3 (pagamento recebido) ficam de fora; b-3 (transferência própria) entra como transfer.
		expect(Object.keys(byExt).sort()).toEqual(["b-1", "b-2", "b-3", "b-4", "c-1", "c-2", "c-4"]);
		expect(byExt["b-3"]).toMatchObject({ kind: "transfer", amountCents: 30_000, counterpartAccountId: null });
		expect(byExt["b-1"]).toMatchObject({
			kind: "expense",
			amountCents: 15_237,
			accountId: account?.id,
			status: "confirmed",
			source: "pluggy",
		});
		expect(byExt["b-2"]).toMatchObject({ kind: "income", amountCents: 450_000, date: "2026-11-05" });
		expect(byExt["b-4"]).toMatchObject({
			kind: "card_payment",
			accountId: account?.id,
			cardId: card?.id,
			amountCents: 83_010,
		});
		expect(byExt["c-1"]).toMatchObject({
			kind: "expense",
			amountCents: 10_030,
			cardId: card?.id,
			invoiceMonth: "2026-11",
		});
		expect(byExt["c-2"]).toMatchObject({
			kind: "expense",
			amountCents: 25_000,
			invoiceMonth: "2026-11",
			note: "Parcela 2/6",
		});
		expect(byExt["c-4"]).toMatchObject({
			kind: "refund",
			amountCents: 10_030,
			refundOfId: byExt["c-1"]?.id,
			invoiceMonth: "2026-12",
		});

		const [connection] = await t.stores.pluggyConnections.list();
		expect(connection).toMatchObject({ lastStatus: "ok", lastError: null, lastSyncAt: NOW });
		expect(result.connections[0]).toMatchObject({
			created: 7,
			skipped: { pending: 1, card_payment: 1, refund_without_original: 1 },
		});
	});

	it("rodar de novo não duplica nada", async () => {
		await t.run();
		const before = await everything(t.stores);
		const second = await t.run();
		const after = await everything(t.stores);
		expect(after).toEqual(before);
		expect(await t.stores.accounts.list()).toHaveLength(1);
		expect(await t.stores.cards.list()).toHaveLength(1);
		// A segunda rodada relê os 4 meses: os 6 lançamentos já existem.
		expect(second.connections[0]).toMatchObject({ created: 0, existing: 7, status: "ok" });
	});

	it("busca os 4 meses anteriores, também na sincronização seguinte", async () => {
		await t.run();
		const from = () =>
			t.fake.requests
				.filter((r) => r.url.pathname === "/v2/transactions")
				.map((r) => r.url.searchParams.get("dateFrom"));
		expect(from()).toEqual(["2026-07-13", "2026-07-13"]);
		expect(
			t.fake.requests.find((r) => r.url.pathname === "/v2/transactions")?.url.searchParams.get("dateTo"),
		).toBe("2026-11-12");

		t.fake.requests.length = 0;
		t.setNow(new Date("2026-11-13T09:00:00Z"));
		await t.run();
		expect(from()).toEqual(["2026-07-14", "2026-07-14"]);
	});

	it("o lançamento que o dono apagou não volta", async () => {
		await t.run();
		const mercado = (await everything(t.stores)).find((r) => r.externalId === "b-1");
		await t.stores.transactions.softDelete(mercado?.id ?? "");
		await t.run();
		expect((await everything(t.stores)).find((r) => r.externalId === "b-1")).toBeUndefined();
	});

	it("conta arquivada pelo dono não recebe lançamento", async () => {
		await t.run();
		const [account] = await t.stores.accounts.list();
		await t.stores.accounts.archive(account?.id ?? "");
		const before = (await everything(t.stores)).length;
		const result = await t.run();
		expect(result.status).toBe("ok");
		expect((await everything(t.stores)).length).toBe(before);
		expect(result.connections[0]?.skipped.archived_account).toBe(1);
		expect(await t.stores.accounts.list()).toEqual([]); // não recriou
	});

	it("fechamento e vencimento ajustados pelo dono sobrevivem; só o limite acompanha o banco", async () => {
		await t.run();
		const [card] = await t.stores.cards.list();
		await t.stores.cards.update(card?.id ?? "", { closingDay: 5, dueDay: 12 });
		await t.run();
		expect((await t.stores.cards.list())[0]).toMatchObject({
			closingDay: 5,
			dueDay: 12,
			limitCents: 500_000,
		});

		const raised = { ...cardAccount, creditData: { ...cardAccount.creditData, creditLimit: 7000 } };
		const t2 = setup({ accounts: [raised] });
		await t2.stores.pluggyConnections.add({ id: ITEM_ID });
		await t2.run();
		const first = (await t2.stores.cards.list())[0];
		expect(first?.limitCents).toBe(700_000);
	});

	it("plano B: dois cartões com fatura do mesmo total não deixam adivinhar; fica de fora, com aviso", async () => {
		const other = { ...cardAccount, id: "0f1d2c3b-aaaa-4bbb-8ccc-000000000003", number: "9999" };
		const t2 = setup({
			accounts: [(await import("./fake-pluggy.ts")).bankAccount, cardAccount, other],
			transactions: { [BANK_ACCOUNT_ID]: bankTxs, [CARD_ACCOUNT_ID]: [], [other.id]: [] },
			bills: {
				[CARD_ACCOUNT_ID]: [bill("a", "2026-11-17T00:00:00.000Z", 830.1)],
				[other.id]: [bill("b", "2026-11-20T00:00:00.000Z", 830.1)],
			},
		});
		await t2.stores.pluggyConnections.add({ id: ITEM_ID });
		const result = await t2.run();
		expect(result.connections[0]?.skipped.card_payment_unlinked).toBe(1);
		expect(result.connections[0]?.notes.join(" ")).toContain("pagamento(s) de fatura não foram ligados");
		expect((await everything(t2.stores)).some((r) => r.kind === "card_payment")).toBe(false);
	});

	it("pagamento de fatura casa pelo /bills (valor + dia) e acha o cartão certo mesmo com dois cartões", async () => {
		const other = { ...cardAccount, id: "0f1d2c3b-aaaa-4bbb-8ccc-000000000003", number: "9999" };
		const bill = (amount: number, paymentDate: string) => ({
			id: "bill",
			dueDate: "2026-11-17T00:00:00.000Z",
			payments: [{ id: "p", paymentDate, amount, currencyCode: "BRL" }],
		});
		const t2 = setup({
			accounts: [(await import("./fake-pluggy.ts")).bankAccount, cardAccount, other],
			transactions: {
				// Sem categoria de pagamento: só o /bills sabe que é a fatura do segundo cartão.
				[BANK_ACCOUNT_ID]: [
					tx("pay", {
						description: "Débito automático",
						amount: -1200,
						category: null,
						date: "2026-11-05T00:00:00.000Z",
					}),
				],
				[CARD_ACCOUNT_ID]: [],
				[other.id]: [],
			},
			bills: { [CARD_ACCOUNT_ID]: [], [other.id]: [bill(1200, "2026-11-06T00:00:00.000Z")] },
		});
		await t2.stores.pluggyConnections.add({ id: ITEM_ID });
		expect((await t2.run()).status).toBe("ok");
		const cards = await t2.stores.cards.list();
		const second = cards.find((c) => c.externalId === other.id);
		expect((await everything(t2.stores))[0]).toMatchObject({
			kind: "card_payment",
			cardId: second?.id,
			amountCents: 120_000,
		});
	});

	it("transferência para o próprio CPF vira transferência (nem gasto nem receita) mesmo sem categoria", async () => {
		const own = { documentNumber: { type: "CPF", value: "12345678900" } };
		const t2 = setup({
			transactions: {
				[BANK_ACCOUNT_ID]: [
					tx("self", {
						description: "Pix enviado",
						amount: -500,
						category: "Transfers",
						paymentData: { payer: own, receiver: own },
					}),
					tx("self2", {
						description: "Pix recebido",
						type: "CREDIT",
						amount: 80,
						category: null,
						paymentData: { payer: { documentNumber: { value: "123.456.789-00" } }, receiver: null },
					}),
					tx("other", {
						description: "Pix para fulano",
						amount: -50,
						category: "Transfers",
						paymentData: { payer: own, receiver: { documentNumber: { type: "CPF", value: "98765432100" } } },
					}),
				],
				[CARD_ACCOUNT_ID]: [],
			},
		});
		await t2.stores.pluggyConnections.add({ id: ITEM_ID });
		await t2.run();
		const rows = await everything(t2.stores);
		expect(rows.map((r) => [r.externalId, r.kind]).sort()).toEqual([
			["other", "expense"],
			["self", "transfer"],
			["self2", "transfer"],
		]);
		expect(rows.every((r) => r.kind !== "transfer" || r.counterpartAccountId === null)).toBe(true);
	});

	it("item esperando ação do dono (WAITING_USER_ACTION) pede para reconectar", async () => {
		const t2 = setup({ item: { status: "WAITING_USER_ACTION" } });
		await t2.stores.pluggyConnections.add({ id: ITEM_ID });
		expect((await t2.run()).status).toBe("error");
		expect((await t2.stores.pluggyConnections.list())[0]?.lastError).toContain("reconectar");
	});

	it("sem chaves: não chama o Pluggy, grava 'no_keys' e não dá erro", async () => {
		const t2 = setup({}, { pluggy_client_id: null, pluggy_client_secret: null });
		await t2.stores.pluggyConnections.add({ id: ITEM_ID });
		const result = await t2.run();
		expect(result.status).toBe("no_keys");
		expect(t2.fake.requests).toEqual([]);
		expect((await t2.stores.pluggyConnections.list())[0]).toMatchObject({
			lastStatus: "no_keys",
			lastError: null,
		});
		// Só o secret faltando também conta.
		const t3 = setup({}, { pluggy_client_id: CLIENT_ID, pluggy_client_secret: null });
		await t3.stores.pluggyConnections.add({ id: ITEM_ID });
		expect((await t3.run()).status).toBe("no_keys");
	});

	it("sem conexões: nada a fazer", async () => {
		const t2 = setup();
		expect(await t2.run()).toEqual({ status: "no_connections", connections: [] });
		expect(t2.fake.requests).toEqual([]);
	});

	it("chaves que não abrem (APP_SECRET trocado): erro claro, sem vazar nada", async () => {
		const deps = { ...t.deps(), readSecret: async () => Promise.reject(new Error(`boom ${CLIENT_SECRET}`)) };
		const result = await syncPluggy(deps);
		expect(result.status).toBe("error");
		const [c] = await t.stores.pluggyConnections.list();
		expect(c?.lastStatus).toBe("error");
		expect(c?.lastError).toContain("APP_SECRET");
		expect(c?.lastError).not.toContain(CLIENT_SECRET);
	});

	it("chaves recusadas pelo Pluggy: erro sanitizado e a janela não avança", async () => {
		const deps = { ...t.deps(), readSecret: async () => "chave-errada-123" };
		const result = await syncPluggy(deps);
		expect(result.status).toBe("error");
		const [c] = await t.stores.pluggyConnections.list();
		expect(c).toMatchObject({ lastStatus: "error", lastSyncAt: null });
		expect(c?.lastError).toContain("Client Secret");
		expect(c?.lastError).not.toContain("chave-errada-123");
		expect(JSON.stringify(c)).not.toContain(API_KEY);
	});

	it("banco pedindo para reconectar: erro com instrução, sem importar nada", async () => {
		const t2 = setup({ item: { status: "LOGIN_ERROR" } });
		await t2.stores.pluggyConnections.add({ id: ITEM_ID });
		const result = await t2.run();
		expect(result.status).toBe("error");
		expect((await t2.stores.pluggyConnections.list())[0]?.lastError).toContain("reconectar");
		expect(await everything(t2.stores)).toEqual([]);
	});

	it("uma conta que falha deixa a conexão 'partial' e não avança a janela; as outras entram", async () => {
		const t2 = setup({
			override: (url) =>
				url.pathname === "/v2/transactions" && url.searchParams.get("accountId") === CARD_ACCOUNT_ID
					? new Response("{}", { status: 503 })
					: undefined,
		});
		await t2.stores.pluggyConnections.add({ id: ITEM_ID });
		const result = await t2.run();
		expect(result.status).toBe("partial");
		const [c] = await t2.stores.pluggyConnections.list();
		expect(c).toMatchObject({ lastStatus: "partial", lastSyncAt: null });
		expect(c?.lastError).toContain("1 conta(s) não sincronizaram");
		expect((await everything(t2.stores)).map((r) => r.externalId).sort()).toEqual([
			"b-1",
			"b-2",
			"b-3",
			"b-4",
		]);
	});

	it("uma conexão com erro não impede as outras", async () => {
		const missing = "99999999-9999-4999-8999-999999999999";
		await t.stores.pluggyConnections.add({ id: missing });
		const result = await t.run();
		const byId = Object.fromEntries(result.connections.map((c) => [c.id, c.status]));
		expect(byId).toEqual({ [ITEM_ID]: "ok", [missing]: "error" });
		expect(result.status).toBe("partial");
		expect((await t.stores.pluggyConnections.get(missing))?.lastError).toContain("não achou esta conexão");
	});

	it("o estorno que ainda não achava a compra entra quando ela aparece", async () => {
		await t.run();
		expect((await everything(t.stores)).some((r) => r.externalId === "c-5")).toBe(false);
		// A compra "Loja que não existe" chega depois (efetivada com atraso).
		cardTxs.push(
			tx("c-6", { description: "Loja que não existe", amount: 20, date: "2026-11-06T00:00:00.000Z" }),
		);
		try {
			await t.run();
		} finally {
			cardTxs.pop();
		}
		const rows = await everything(t.stores);
		const refund = rows.find((r) => r.externalId === "c-5");
		expect(refund).toMatchObject({
			kind: "refund",
			refundOfId: rows.find((r) => r.externalId === "c-6")?.id,
		});
	});

	it("nunca grava chave, token nem corpo de resposta no banco", async () => {
		await t.run();
		const dump = JSON.stringify({
			conns: await t.stores.pluggyConnections.list(),
			rows: await everything(t.stores),
			accounts: await t.stores.accounts.list(),
			cards: await t.stores.cards.list(),
		});
		for (const secret of [CLIENT_ID, CLIENT_SECRET, API_KEY]) expect(dump).not.toContain(secret);
	});

	describe("janela, estado do banco e faturas", () => {
		const jan = (extra: Record<string, unknown>) =>
			tx("c-late", { description: "Compra tardia", amount: 75, ...extra });

		it("lançamento do cartão que efetiva semanas depois ainda entra (sobreposição de 40 dias)", async () => {
			await t.run(); // 12/11, lastSyncAt = 12/11
			cardTxs.push(jan({ date: "2026-10-25T00:00:00.000Z" })); // 18 dias antes da última sincronização
			try {
				t.setNow(new Date("2026-12-02T09:00:00Z"));
				await t.run();
			} finally {
				cardTxs.pop();
			}
			expect((await everything(t.stores)).find((r) => r.externalId === "c-late")).toMatchObject({
				kind: "expense",
				amountCents: 7500,
			});
		});

		it.each(["OUTDATED", "UPDATING"])(
			"item %s: importa o que veio, mas fica 'partial' e a janela não avança",
			async (status) => {
				const t2 = setup({ item: { status } });
				await t2.stores.pluggyConnections.add({ id: ITEM_ID });
				const result = await t2.run();
				expect(result.status).toBe("partial");
				expect(result.connections[0]?.notes).toContain("O banco não atualizou os dados no Pluggy ainda.");
				const [c] = await t2.stores.pluggyConnections.list();
				expect(c).toMatchObject({ lastStatus: "partial", lastSyncAt: null });
				expect(c?.lastError).toContain("banco não atualizou");
				expect((await everything(t2.stores)).length).toBeGreaterThan(0);
			},
		);

		it("falha nas faturas: débitos que podem ser pagamento ficam de fora, conexão 'partial'; na volta, entram certos", async () => {
			let broken = true;
			const t2 = setup({
				bills: { [CARD_ACCOUNT_ID]: [bill("bill-nov", "2026-11-17T00:00:00.000Z", 830.1)] },
				override: (url) =>
					broken && url.pathname === "/bills" ? new Response("{}", { status: 503 }) : undefined,
			});
			await t2.stores.pluggyConnections.add({ id: ITEM_ID });
			const first = await t2.run();
			expect(first.status).toBe("partial");
			// Débitos da conta (b-1, b-3, b-4) e créditos do cartão (c-3, c-4, c-5).
			expect(first.connections[0]?.skipped.bills_unavailable).toBe(6);
			const [c] = await t2.stores.pluggyConnections.list();
			expect(c).toMatchObject({ lastStatus: "partial", lastSyncAt: null });
			expect(c?.lastError).toContain("faturas do cartão não carregaram");
			const ids = (await everything(t2.stores)).map((r) => r.externalId);
			expect(ids).not.toContain("b-4"); // nunca vira "gasto" por engano
			expect(ids).toContain("b-2"); // receita e compras no cartão não dependem das faturas
			expect(ids).toContain("c-1");

			broken = false;
			expect((await t2.run()).status).toBe("ok");
			expect((await everything(t2.stores)).find((r) => r.externalId === "b-4")).toMatchObject({
				kind: "card_payment",
			});
		});

		describe("datas do cartão", () => {
			const noDates = {
				...cardAccount,
				creditData: { ...cardAccount.creditData, balanceCloseDate: null, balanceDueDate: null },
			};
			const run = async (options: FakePluggyOptions) => {
				const t2 = setup({ accounts: [bankAccount, noDates], ...options });
				await t2.stores.pluggyConnections.add({ id: ITEM_ID });
				const result = await t2.run();
				return { t2, result };
			};

			it("creditData sem datas: usa a fatura mais recente (fechamento e vencimento)", async () => {
				const { t2, result } = await run({
					bills: {
						[CARD_ACCOUNT_ID]: [
							{
								...bill("b-old", "2026-10-08T00:00:00.000Z", 10),
								billClosingDate: "2026-10-01T00:00:00.000Z",
							},
							{
								...bill("b-new", "2026-11-09T00:00:00.000Z", 830.1),
								billClosingDate: "2026-11-02T00:00:00.000Z",
							},
						],
					},
				});
				expect(result.status).toBe("ok");
				expect(await t2.stores.cards.list()).toEqual([expect.objectContaining({ closingDay: 2, dueDay: 9 })]);
				expect(result.connections[0]?.notes.join()).not.toContain("estimad");
			});

			it("só o vencimento: fechamento 7 dias antes, com aviso de estimado", async () => {
				const { t2, result } = await run({
					bills: { [CARD_ACCOUNT_ID]: [bill("b", "2026-11-05T00:00:00.000Z", 830.1)] },
				});
				expect(await t2.stores.cards.list()).toEqual([
					expect.objectContaining({ closingDay: 29, dueDay: 5 }),
				]);
				expect(result.connections[0]?.notes.join()).toContain("estimado");
			});

			it("conector sem faturas (404) e sem datas: cria o cartão com dias padrão e avisa que são estimados", async () => {
				const { t2, result } = await run({ bills: {} });
				expect(result.status).toBe("ok");
				expect(await t2.stores.cards.list()).toEqual([
					expect.objectContaining({ closingDay: 20, dueDay: 27 }),
				]);
				expect(result.connections[0]?.notes.join()).toContain("datas estimadas");
				// As compras do cartão entram.
				expect((await everything(t2.stores)).some((r) => r.externalId === "c-1")).toBe(true);
			});

			it("falha de verdade nas faturas e sem datas: não inventa dias; cartão espera, conexão 'partial'; depois entra", async () => {
				let broken = true;
				const t2 = setup({
					accounts: [bankAccount, noDates],
					bills: {
						[CARD_ACCOUNT_ID]: [
							{
								...bill("b", "2026-11-09T00:00:00.000Z", 830.1),
								billClosingDate: "2026-11-02T00:00:00.000Z",
							},
						],
					},
					override: (url) =>
						broken && url.pathname === "/bills" ? new Response("{}", { status: 503 }) : undefined,
				});
				await t2.stores.pluggyConnections.add({ id: ITEM_ID });
				expect((await t2.run()).status).toBe("partial");
				expect(await t2.stores.cards.list()).toEqual([]);
				broken = false;
				expect((await t2.run()).status).toBe("ok");
				expect(await t2.stores.cards.list()).toEqual([expect.objectContaining({ closingDay: 2, dueDay: 9 })]);
			});
		});

		describe("classificação pelas categorias do Pluggy", () => {
			const categories = [
				{ id: "03000000", description: "Investments" },
				{
					id: "03020000",
					description: "Fixed income",
					parentId: "03000000",
					parentDescription: "Investments",
				},
				{ id: "10000000", description: "Healthcare" },
				{ id: "10020000", description: "Pharmacy", parentId: "10000000", parentDescription: "Healthcare" },
			];
			const txs = [
				tx("i-1", {
					description: "Aplicação CDB",
					amount: -1000,
					category: "Fixed income",
					categoryId: "03020000",
				}),
				tx("i-2", {
					description: "Resgate CDB",
					type: "CREDIT",
					amount: 1000,
					category: "Fixed income",
					categoryId: "03020000",
				}),
				tx("i-3", {
					description: "Rendimento",
					type: "CREDIT",
					amount: 2.5,
					category: "Interests on investments",
				}),
				tx("i-4", { description: "Drogaria", amount: -30, category: "Pharmacy", categoryId: "10020000" }),
				tx("i-5", { description: "Sem nome", amount: -30, category: null, categoryId: null }),
			];

			it("aplicação é investimento (não gasto) em Investimentos; resgate e rendimento são receita nessa categoria", async () => {
				const t2 = setup({ categories, transactions: { [BANK_ACCOUNT_ID]: txs, [CARD_ACCOUNT_ID]: [] } });
				await t2.stores.pluggyConnections.add({ id: ITEM_ID });
				const result = await t2.run();
				expect(result.status).toBe("ok");
				expect(result.connections[0]?.skipped.investment).toBeUndefined();
				const cats = new Map((await t2.stores.categories.list()).map((c) => [c.id, c.slug]));
				const rows = Object.fromEntries((await everything(t2.stores)).map((r) => [r.externalId, r]));
				expect(Object.keys(rows).sort()).toEqual(["i-1", "i-2", "i-3", "i-4", "i-5"]);
				expect(rows["i-1"]).toMatchObject({ kind: "investment" });
				expect(cats.get(rows["i-1"]?.categoryId ?? "")).toBe("investimentos");
				expect(rows["i-2"]).toMatchObject({ kind: "income" });
				expect(cats.get(rows["i-2"]?.categoryId ?? "")).toBe("investimentos");
				expect(rows["i-3"]).toMatchObject({ kind: "income" });
				expect(cats.get(rows["i-3"]?.categoryId ?? "")).toBe("investimentos");
				expect(cats.get(rows["i-4"]?.categoryId ?? "")).toBe("saude");
				expect(cats.get(rows["i-5"]?.categoryId ?? "")).toBe("outros");
			});

			it("aplicação gravada como despesa (antes do tipo investment) é recalculada e sai do gasto", async () => {
				const t2 = setup({ categories, transactions: { [BANK_ACCOUNT_ID]: txs, [CARD_ACCOUNT_ID]: [] } });
				await t2.stores.pluggyConnections.add({ id: ITEM_ID });
				await t2.run();
				const before = (await everything(t2.stores)).find((r) => r.externalId === "i-1");
				// Como estava gravado antes: despesa na categoria Investimentos.
				await t2.stores.transactions.update(before?.id ?? "", { kind: "expense" });
				const again = await t2.run();
				expect(again.connections[0]?.reclassified).toBe(1);
				const after = (await everything(t2.stores)).find((r) => r.externalId === "i-1");
				expect(after).toMatchObject({ id: before?.id, kind: "investment" });
			});

			it("busca /categories uma vez por rodada; se falhar, segue pelo nome e avisa", async () => {
				const t2 = setup({ categories, transactions: { [BANK_ACCOUNT_ID]: txs, [CARD_ACCOUNT_ID]: [] } });
				await t2.stores.pluggyConnections.add({ id: ITEM_ID });
				await t2.stores.pluggyConnections.add({ id: "9f8e7d6c-5b4a-4321-8fed-cba987654321" });
				await t2.run();
				expect(t2.fake.requests.filter((r) => r.url.pathname === "/categories")).toHaveLength(1);

				const t3 = setup({ transactions: { [BANK_ACCOUNT_ID]: txs, [CARD_ACCOUNT_ID]: [] } }); // /categories dá 404
				await t3.stores.pluggyConnections.add({ id: ITEM_ID });
				const result = await t3.run();
				expect(result.status).toBe("ok");
				expect(result.connections[0]?.notes.join()).toContain("categorias do Pluggy não carregaram");
				// Pelo nome da categoria do lançamento, a aplicação entra em Investimentos.
				const cats = new Map((await t3.stores.categories.list()).map((c) => [c.id, c.slug]));
				const rows = Object.fromEntries((await everything(t3.stores)).map((r) => [r.externalId, r]));
				expect(rows["i-1"]).toMatchObject({ kind: "investment" });
				expect(cats.get(rows["i-1"]?.categoryId ?? "")).toBe("investimentos");
			});
		});

		it("conector sem faturas (404) vale como 'sem faturas', sem ficar partial", async () => {
			const t2 = setup({ bills: {} });
			await t2.stores.pluggyConnections.add({ id: ITEM_ID });
			const result = await t2.run();
			expect(result.status).toBe("ok");
			expect(result.connections[0]?.skipped.card_payment_unlinked).toBe(1);
		});

		it("billId com fatura conhecida decide o invoiceMonth; sem ela vale o engine", async () => {
			const t2 = setup({
				transactions: {
					[BANK_ACCOUNT_ID]: [],
					[CARD_ACCOUNT_ID]: [
						// 09/11 caiu na fatura de dezembro segundo o banco (o engine diria novembro).
						tx("with-bill", {
							amount: 10,
							date: "2026-11-09T00:00:00.000Z",
							creditCardMetadata: { billId: "bill-dez" },
						}),
						tx("no-bill", { amount: 11, date: "2026-11-09T00:00:00.000Z" }),
						tx("unknown-bill", {
							amount: 12,
							date: "2026-11-09T00:00:00.000Z",
							creditCardMetadata: { billId: "?" },
						}),
					],
				},
				bills: { [CARD_ACCOUNT_ID]: [bill("bill-dez", "2026-12-17T00:00:00.000Z", 10)] },
			});
			await t2.stores.pluggyConnections.add({ id: ITEM_ID });
			await t2.run();
			const by = Object.fromEntries((await everything(t2.stores)).map((r) => [r.externalId, r.invoiceMonth]));
			expect(by).toEqual({ "with-bill": "2026-12", "no-bill": "2026-11", "unknown-bill": "2026-11" });
		});

		it("compra gravada na fatura errada (antes do billId) é corrigida pela fatura que o banco indica", async () => {
			const t2 = setup({
				transactions: {
					[BANK_ACCOUNT_ID]: [],
					[CARD_ACCOUNT_ID]: [
						tx("with-bill", {
							amount: 10,
							date: "2026-11-09T00:00:00.000Z",
							creditCardMetadata: { billId: "bill-dez" },
						}),
						tx("no-bill", { amount: 11, date: "2026-11-09T00:00:00.000Z" }),
					],
				},
				bills: { [CARD_ACCOUNT_ID]: [bill("bill-dez", "2026-12-17T00:00:00.000Z", 10)] },
			});
			await t2.stores.pluggyConnections.add({ id: ITEM_ID });
			await t2.run();
			// Como estava gravado por uma versão que ainda calculava só pelo fechamento (a compra pesava em novembro).
			for (const row of await everything(t2.stores)) {
				await t2.stores.transactions.update(row.id, { invoiceMonth: "2026-11", budgetMonth: "2026-11" });
			}
			await t2.run();
			const by = Object.fromEntries((await everything(t2.stores)).map((r) => [r.externalId, r.invoiceMonth]));
			// Só a que tem fatura do banco muda; a calculada pelo engine continua como está.
			expect(by).toEqual({ "with-bill": "2026-12", "no-bill": "2026-11" });
		});

		it("o pagamento da fatura consome um débito só: aluguel de mesmo valor 2 dias depois continua gasto", async () => {
			const t2 = setup({
				transactions: {
					[BANK_ACCOUNT_ID]: [
						tx("rent", {
							description: "Aluguel",
							amount: -1200,
							category: null,
							date: "2026-11-07T00:00:00.000Z",
						}),
						tx("fatura", {
							description: "Débito",
							amount: -1200,
							category: null,
							date: "2026-11-05T00:00:00.000Z",
						}),
					],
					[CARD_ACCOUNT_ID]: [],
				},
				bills: {
					[CARD_ACCOUNT_ID]: [
						bill("b", "2026-11-17T00:00:00.000Z", 1200, [
							{ paymentDate: "2026-11-05T00:00:00.000Z", amount: 1200 },
						]),
					],
				},
			});
			await t2.stores.pluggyConnections.add({ id: ITEM_ID });
			await t2.run();
			const by = Object.fromEntries((await everything(t2.stores)).map((r) => [r.externalId, r.kind]));
			expect(by).toEqual({ fatura: "card_payment", rent: "expense" });
		});

		it("no cartão: o crédito do pagamento é ignorado e o estorno real de mesmo valor continua estorno", async () => {
			const t2 = setup({
				transactions: {
					[BANK_ACCOUNT_ID]: [],
					[CARD_ACCOUNT_ID]: [
						tx("loja", { description: "Loja", amount: 300, date: "2026-10-20T00:00:00.000Z" }),
						tx("pagto", {
							description: "Crédito",
							type: "CREDIT",
							amount: -300,
							category: null,
							date: "2026-11-05T00:00:00.000Z",
						}),
						tx("estorno", {
							description: "Loja",
							type: "CREDIT",
							amount: -300,
							category: null,
							date: "2026-11-06T00:00:00.000Z",
						}),
					],
				},
				bills: {
					[CARD_ACCOUNT_ID]: [
						bill("b", "2026-11-17T00:00:00.000Z", 300, [
							{ paymentDate: "2026-11-05T00:00:00.000Z", amount: 300 },
						]),
					],
				},
			});
			await t2.stores.pluggyConnections.add({ id: ITEM_ID });
			await t2.run();
			const by = Object.fromEntries((await everything(t2.stores)).map((r) => [r.externalId, r.kind]));
			expect(by).toEqual({ loja: "expense", estorno: "refund" });
		});

		it("linha fora do formato é descartada e anotada; o resto entra e a conexão segue 'ok'", async () => {
			const t2 = setup({
				transactions: {
					[BANK_ACCOUNT_ID]: [
						tx("bom", { amount: -5 }),
						{ id: "ruim", date: "2026-11-03T00:00:00.000Z", segredo: "texto do banco" },
						tx("torto", { amount: { v: 1 } }),
					] as never,
					[CARD_ACCOUNT_ID]: [],
				},
			});
			await t2.stores.pluggyConnections.add({ id: ITEM_ID });
			const logs: string[] = [];
			const result = await syncPluggy({ ...t2.deps(), log: (l) => logs.push(l) });
			expect(result.status).toBe("ok");
			expect(result.connections[0]?.notes).toContain(
				"2 lançamento(s) vieram fora do formato e foram descartados.",
			);
			expect((await everything(t2.stores)).map((r) => r.externalId)).toEqual(["bom"]);
			expect(JSON.stringify([logs, result])).not.toContain("texto do banco");
		});
	});
	describe("nome da conexão e das contas", () => {
		const meu = (over: object = {}) =>
			setup({
				item: { connector: { id: 1, name: "MeuPluggy", isSandbox: false } },
				accounts: [
					{ ...bankAccount, name: "MeuPluggy Banco Santander (Brasil) S.A.", marketingName: null },
					{ ...cardAccount, name: "Cartão", marketingName: "MeuPluggy Mercado Pago" },
				],
				transactions: { [BANK_ACCOUNT_ID]: [], [CARD_ACCOUNT_ID]: [] },
				...over,
			});

		it("nomeia a conexão pelas contas, limpa o prefixo, e guarda o resumo", async () => {
			const t2 = meu();
			await t2.stores.pluggyConnections.add({ id: ITEM_ID, label: "MeuPluggy" });
			await t2.run();
			expect(await t2.stores.pluggyConnections.get(ITEM_ID)).toMatchObject({
				label: "Santander, Mercado Pago",
				labelEditedByOwner: false,
				accountCount: 1,
				cardCount: 1,
			});
			expect((await t2.stores.accounts.list())[0]?.name).toBe("Santander");
			expect((await t2.stores.cards.list())[0]?.name).toBe("Mercado Pago");
		});

		it("nome do dono nunca é sobrescrito, nem o que ele renomeou depois", async () => {
			const t2 = meu();
			await t2.stores.pluggyConnections.add({ id: ITEM_ID, label: "MeuPluggy" });
			await t2.stores.pluggyConnections.rename(ITEM_ID, "MeuPluggy");
			await t2.run();
			expect((await t2.stores.pluggyConnections.get(ITEM_ID))?.label).toBe("MeuPluggy");

			const t3 = meu();
			await t3.stores.pluggyConnections.add({ id: ITEM_ID, label: "Minha conta" });
			await t3.run();
			expect((await t3.stores.pluggyConnections.get(ITEM_ID))?.label).toBe("Minha conta");
		});

		it("conta já importada com prefixo MeuPluggy é limpa uma vez; a que o dono renomeou fica", async () => {
			const t2 = meu();
			await t2.stores.pluggyConnections.add({ id: ITEM_ID });
			const old = await t2.stores.accounts.create({
				name: "MeuPluggy Banco Santander (Brasil) S.A.",
				kind: "checking",
				source: "pluggy",
				externalId: BANK_ACCOUNT_ID,
			});
			const mine = await t2.stores.cards.create({
				name: "Meu cartão",
				closingDay: 10,
				dueDay: 17,
				source: "pluggy",
				externalId: CARD_ACCOUNT_ID,
			});
			await t2.run();
			expect((await t2.stores.accounts.get(old.id))?.name).toBe("Santander");
			expect((await t2.stores.cards.get(mine.id))?.name).toBe("Meu cartão");
		});

		it("conector que não é o MeuPluggy mantém o nome do banco", async () => {
			const t2 = setup({ transactions: { [BANK_ACCOUNT_ID]: [], [CARD_ACCOUNT_ID]: [] } });
			await t2.stores.pluggyConnections.add({ id: ITEM_ID, label: "Nubank" });
			await t2.run();
			expect((await t2.stores.pluggyConnections.get(ITEM_ID))?.label).toBe("Nubank");
		});

		it("falha ao gravar o nome só vira nota: o sync segue e conta o resumo", async () => {
			const t2 = meu();
			await t2.stores.pluggyConnections.add({ id: ITEM_ID, label: "MeuPluggy" });
			t2.stores.pluggyConnections.setAutoLabel = async () => {
				throw new Error("segredo-do-banco");
			};
			const result = await t2.run();
			expect(result.status).toBe("ok");
			expect(result.connections[0]?.notes).toContain("Não deu para sugerir o nome da conexão agora.");
			expect(JSON.stringify(result)).not.toContain("segredo-do-banco");
			expect(await t2.stores.pluggyConnections.get(ITEM_ID)).toMatchObject({ accountCount: 1, cardCount: 1 });
		});

		it("erro antes de ligar as contas não zera o resumo", async () => {
			const t2 = meu();
			await t2.stores.pluggyConnections.add({ id: ITEM_ID });
			await t2.run();
			const t3 = { ...t2, fake: fakePluggy({ item: { status: "LOGIN_ERROR" } }) };
			await syncPluggy({ ...t2.deps(), fetch: t3.fake.fetch });
			expect(await t2.stores.pluggyConnections.get(ITEM_ID)).toMatchObject({
				lastStatus: "error",
				accountCount: 1,
				cardCount: 1,
			});
		});
	});

	describe("categoria do banco, regras e diagnóstico", () => {
		const withTxs = (list: object[]) =>
			setup({
				accounts: [bankAccount],
				transactions: { [BANK_ACCOUNT_ID]: list as never },
				bills: {},
			});
		const pixTree = [
			{ id: "20000000", description: "Transfers" },
			{ id: "20010000", description: "Transfer - PIX", parentId: "20000000", parentDescription: "Transfers" },
		];
		const pix = (id: string, description: string, extra: object = {}) =>
			tx(id, { description, category: "Transfer - PIX", categoryId: "20010000", ...extra });

		it("grava a categoria do banco e o nome do estabelecimento; sem árvore usa só o texto do lançamento", async () => {
			const t2 = withTxs([
				pix("p-1", "Pix enviado - Rei Dos Lanches 12/11", { merchant: { name: "Rei dos Lanches" } }),
				tx("p-2", { description: "Sem categoria", category: null, categoryId: null }),
			]);
			await t2.stores.pluggyConnections.add({ id: ITEM_ID });
			await t2.run();
			const rows = await everything(t2.stores);
			const byExt = Object.fromEntries(rows.map((r) => [r.externalId, r]));
			expect(byExt["p-1"]).toMatchObject({
				sourceCategory: "Transfer - PIX",
				merchantName: "Rei dos Lanches",
			});
			expect(byExt["p-2"]).toMatchObject({ sourceCategory: null, merchantName: null });

			const t3 = setup({
				accounts: [bankAccount],
				transactions: { [BANK_ACCOUNT_ID]: [pix("p-1", "Pix enviado - X")] },
				categories: pixTree,
				bills: {},
			});
			await t3.stores.pluggyConnections.add({ id: ITEM_ID });
			await t3.run();
			expect((await everything(t3.stores))[0]?.sourceCategory).toBe("Transfers › Transfer - PIX");
		});

		it("conta o que caiu em Outros por categoria do banco, sem descrição nem valor", async () => {
			const t2 = withTxs([
				pix("o-1", "Pix enviado - Fulano Secreto", { amount: 123.45 }),
				pix("o-2", "Pix enviado - Beltrana Secreta", { amount: 77.7 }),
				tx("o-3", { description: "Loja", category: "Shopping", categoryId: null }),
				tx("o-4", { description: "Café", category: "Eating out", categoryId: null }), // categorizado: não entra
			]);
			await t2.stores.pluggyConnections.add({ id: ITEM_ID });
			const result = await t2.run();
			const notes = result.connections[0]?.notes ?? [];
			expect(notes).toContain("Outros: Shopping ×1");
			const text = JSON.stringify(notes);
			expect(text).not.toContain("Secret");
			expect(text).not.toContain("123");
		});

		it("regra do dono vence a tabela do Pluggy; sem regra, o resto segue", async () => {
			const t2 = withTxs([
				pix("r-1", "Pix enviado - Rei Dos Lanches 12/11"),
				pix("r-2", "Pix enviado - Outro Lugar"),
			]);
			await t2.stores.pluggyConnections.add({ id: ITEM_ID });
			await t2.stores.categories.ensureDefaults();
			const delivery = await t2.stores.categories.getBySlug("delivery");
			const transferencias = await t2.stores.categories.getBySlug("transferencias");
			await t2.stores.categoryRules.upsert("rei dos lanches", delivery?.id ?? "");
			const result = await t2.run();
			const byExt = Object.fromEntries((await everything(t2.stores)).map((r) => [r.externalId, r]));
			expect(byExt["r-1"]?.categoryId).toBe(delivery?.id);
			expect(byExt["r-2"]?.categoryId).toBe(transferencias?.id);
			// PIX com categoria própria não entra no diagnóstico de Outros.
			expect(result.connections[0]?.notes.join(" ")).not.toContain("Outros:");
		});

		it("MCC do cartão decide a categoria", async () => {
			const t2 = setup({
				transactions: {
					[BANK_ACCOUNT_ID]: [],
					[CARD_ACCOUNT_ID]: [
						tx("m-1", {
							description: "Estabelecimento qualquer",
							category: null,
							categoryId: null,
							creditCardMetadata: { payeeMCC: 5411 },
						}),
					],
				},
			});
			await t2.stores.pluggyConnections.add({ id: ITEM_ID });
			await t2.run();
			const mercado = await t2.stores.categories.getBySlug("mercado");
			expect((await everything(t2.stores))[0]?.categoryId).toBe(mercado?.id);
		});
	});

	describe("compras parceladas do cartão", () => {
		const parcel = (n: number, day: string, extra: object = {}) =>
			tx(`parc-${n}`, {
				description: n === 3 ? "Geladeira Brastemp 3/6" : "Geladeira Brastemp",
				amount: 250,
				date: `${day}T00:00:00.000Z`,
				category: null,
				categoryId: null,
				creditCardMetadata: {
					installmentNumber: n,
					totalInstallments: 6,
					purchaseDate: "2026-09-05T00:00:00.000Z",
				},
				...extra,
			});
		const setupCard = (list: object[]) =>
			setup({ accounts: [cardAccount], transactions: { [CARD_ACCOUNT_ID]: list as never }, bills: {} });
		const groups = (stores: Stores) => stores.transactions.listInstallmentGroups("2026-01");

		it("a primeira parcela vista cria o grupo e as seguintes entram nele, sem duplicar a compra inteira", async () => {
			const list = [parcel(2, "2026-10-05")];
			const t2 = setupCard(list);
			await t2.stores.pluggyConnections.add({ id: ITEM_ID });
			await t2.run();
			let [group] = await groups(t2.stores);
			expect(group?.installments.map((i) => i.installmentNumber)).toEqual([2]);
			expect(group?.installments[0]).toMatchObject({
				installmentCount: 6,
				amountCents: 25_000,
				date: "2026-09-05",
				budgetMonth: "2026-10",
				source: "pluggy",
			});
			const groupId = group?.groupId;

			list.push(parcel(3, "2026-11-05"));
			await t2.run();
			[group] = await groups(t2.stores);
			expect(group?.groupId).toBe(groupId);
			expect(group?.installments.map((i) => i.installmentNumber)).toEqual([2, 3]);
			// Gasto do mês = só a parcela do mês, nunca a compra inteira.
			const november = await t2.stores.transactions.listByBudgetMonth("2026-11");
			expect(november.map((t) => t.amountCents)).toEqual([25_000]);
		});

		it("re-sync é idempotente (nada novo, nada duplicado)", async () => {
			const t2 = setupCard([parcel(2, "2026-10-05"), parcel(3, "2026-11-05")]);
			await t2.stores.pluggyConnections.add({ id: ITEM_ID });
			const first = await t2.run();
			expect(first.connections[0]?.created).toBe(2);
			const again = await t2.run();
			expect(again.connections[0]).toMatchObject({ created: 0, existing: 2, failed: 0 });
			expect(await groups(t2.stores)).toHaveLength(1);
			expect((await groups(t2.stores))[0]?.installments).toHaveLength(2);
		});

		it("reimport recria o mesmo grupo (id determinístico)", async () => {
			const t2 = setupCard([parcel(2, "2026-10-05"), parcel(3, "2026-11-05")]);
			await t2.stores.pluggyConnections.add({ id: ITEM_ID });
			await t2.run();
			const before = (await groups(t2.stores))[0]?.groupId;
			await t2.stores.pluggyConnections.resetSyncWindow();
			expect(await t2.stores.transactions.hardDeleteBySource("pluggy")).toBe(2);
			expect(await groups(t2.stores)).toEqual([]);
			await t2.run();
			const after = await groups(t2.stores);
			expect(after).toHaveLength(1);
			expect(after[0]?.groupId).toBe(before);
			expect(after[0]?.installments.map((i) => i.installmentNumber)).toEqual([2, 3]);
		});

		it("duas compras idênticas no mesmo dia não perdem gasto: a segunda vira avulsa e a conexão avisa", async () => {
			const twin = tx("twin", {
				description: "Geladeira Brastemp",
				amount: 250,
				date: "2026-10-05T00:00:00.000Z",
				category: null,
				categoryId: null,
				creditCardMetadata: {
					installmentNumber: 2,
					totalInstallments: 6,
					purchaseDate: "2026-09-05T00:00:00.000Z",
				},
			});
			const t2 = setupCard([parcel(2, "2026-10-05"), twin]);
			await t2.stores.pluggyConnections.add({ id: ITEM_ID });
			const result = await t2.run();
			expect(result.connections[0]).toMatchObject({ created: 2, failed: 0 });
			expect(result.connections[0]?.notes.join(" ")).toContain("viraram parcelas avulsas");
			const rows = await everything(t2.stores);
			expect(rows).toHaveLength(2);
			expect(rows.filter((r) => r.installmentGroupId !== null)).toHaveLength(1);
			expect(rows.find((r) => r.installmentGroupId === null)?.note).toBe("Parcela 2/6");
		});
	});

	describe("nome do cartão", () => {
		it("cartão que veio como 'G' ganha o nome do banco, no sync seguinte também para o que já existia", async () => {
			const weak = { ...cardAccount, name: "G", marketingName: null };
			const t2 = setup({
				item: { connector: { id: 1, name: "MeuPluggy", isSandbox: false } },
				accounts: [{ ...bankAccount, name: "Conta Corrente Inter" }, weak],
				transactions: { [BANK_ACCOUNT_ID]: [], [CARD_ACCOUNT_ID]: [] },
			});
			await t2.stores.pluggyConnections.add({ id: ITEM_ID });
			await t2.run();
			expect((await t2.stores.cards.list())[0]?.name).toBe("Inter");

			// Cartão antigo, criado com a inicial: o sync troca o nome fraco.
			const [old] = await t2.stores.cards.list();
			await t2.stores.cards.update(old?.id ?? "", { name: "G" });
			await t2.run();
			expect((await t2.stores.cards.list())[0]?.name).toBe("Inter");
			// Nome que o dono escolheu (bom) fica.
			await t2.stores.cards.update(old?.id ?? "", { name: "Cartão da casa" });
			await t2.run();
			expect((await t2.stores.cards.list())[0]?.name).toBe("Cartão da casa");
		});
	});
});

describe("syncPluggy: corrige o que foi gravado errado antes", () => {
	const pixToSelf = tx("p-self", {
		description: "Pix enviado - Maria de Souza Silva",
		amount: -400,
		category: "Transfer - PIX",
	});
	const pixToThird = tx("p-third", {
		description: "Pix enviado - Rei Dos Coins",
		amount: -90,
		category: "Transfer - PIX",
	});

	const second = {
		...bankAccount,
		id: "0f1d2c3b-aaaa-4bbb-8ccc-000000000003",
		name: "Mercado Pago",
		owner: "Maria de Souza Silva",
	};
	const accountIdOf = async (externalId: string, stores: Stores) =>
		(await everything(stores)).find((r) => r.externalId === externalId);

	it("Pix para si que já contava como gasto, e a entrada que contava como renda, viram transferência no lugar", async () => {
		const out = pixToSelf;
		const inn = tx("p-in", {
			description: "Pix recebido - Maria de Souza Silva",
			type: "CREDIT",
			amount: 400,
			category: "Transfer - PIX",
		});
		const txs = { [BANK_ACCOUNT_ID]: [out, pixToThird], [second.id]: [inn], [CARD_ACCOUNT_ID]: [] };
		// 1ª rodada: o titular da conta ainda não batia com o Pix, então entrou como despesa e como receita.
		const before = setup({
			accounts: [bankAccount, { ...second, owner: "FULANO DE TAL" }, cardAccount],
			transactions: txs,
		});
		await before.stores.pluggyConnections.add({ id: ITEM_ID, label: "Mercado Pago" });
		await before.run();
		expect((await everything(before.stores)).map((r) => [r.externalId, r.kind]).sort()).toEqual([
			["p-in", "income"],
			["p-self", "expense"],
			["p-third", "expense"],
		]);
		const originalOut = await accountIdOf("p-self", before.stores);

		// 2ª rodada: a conta traz o titular certo.
		const fake = fakePluggy({
			accounts: [{ ...bankAccount, owner: "MARIA DE SOUZA SILVA" }, second, cardAccount],
			transactions: txs,
		});
		const again = () =>
			syncPluggy({
				stores: before.stores,
				readSecret: async (name) => SECRETS[name] ?? null,
				fetch: fake.fetch,
				now: () => NOW,
			});
		expect((await again()).connections[0]?.reclassified).toBe(2);
		const self = await accountIdOf("p-self", before.stores);
		const received = await accountIdOf("p-in", before.stores);
		// Mesmos lançamentos (continuam nas Atividades), agora transferência, com par único entre as duas contas.
		expect(self).toMatchObject({
			id: originalOut?.id,
			kind: "transfer",
			amountCents: 40_000,
			categoryId: originalOut?.categoryId,
			note: "Recalculado: transferência entre contas suas.",
		});
		expect(received).toMatchObject({ kind: "transfer", counterpartAccountId: self?.accountId });
		expect(self?.counterpartAccountId).toBe(received?.accountId);
		expect(self?.accountId).not.toBe(received?.accountId);
		expect(await accountIdOf("p-third", before.stores)).toMatchObject({ kind: "expense" });

		// 3ª rodada: nada muda.
		expect((await again()).connections[0]?.reclassified).toBeUndefined();
		expect(await everything(before.stores)).toHaveLength(3);
	});

	it("sem par único, a transferência fica sem destino; com dois candidatos não escolhe", async () => {
		const inn = (id: string) =>
			tx(id, {
				description: "Pix recebido - Maria de Souza Silva",
				type: "CREDIT",
				amount: 400,
				category: "Transfer - PIX",
			});
		const mine = { ...bankAccount, owner: "Maria de Souza Silva" };
		const ambiguous = setup({
			accounts: [mine, second, cardAccount],
			transactions: {
				[BANK_ACCOUNT_ID]: [pixToSelf],
				[second.id]: [inn("in-1"), inn("in-2")],
				[CARD_ACCOUNT_ID]: [],
			},
		});
		await ambiguous.stores.pluggyConnections.add({ id: ITEM_ID, label: "Mercado Pago" });
		await ambiguous.run();
		const rows = await everything(ambiguous.stores);
		expect(rows.map((r) => r.kind)).toEqual(["transfer", "transfer", "transfer"]);
		expect(rows.every((r) => r.counterpartAccountId === null)).toBe(true);
	});

	it("receita gravada como despesa volta a ser receita", async () => {
		const yieldTx = tx("y-1", {
			description: "Rendimentos",
			type: "CREDIT",
			amount: 3.2,
			category: "Interests on investments",
		});
		const t = setup({ transactions: { [BANK_ACCOUNT_ID]: [yieldTx], [CARD_ACCOUNT_ID]: [] } });
		await t.stores.pluggyConnections.add({ id: ITEM_ID, label: "Mercado Pago" });
		await t.run();
		const [row] = await everything(t.stores);
		expect(row).toMatchObject({ kind: "income", amountCents: 320 });
		// Simula a gravação antiga errada.
		await t.stores.transactions.update(row?.id ?? "", { kind: "expense" });
		const result = await t.run();
		expect(result.connections[0]?.reclassified).toBe(1);
		expect((await everything(t.stores))[0]).toMatchObject({ kind: "income" });
	});
});
