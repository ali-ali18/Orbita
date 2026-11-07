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
		// b-3 (transferência própria), b-5 (pendente) e c-3 (pagamento recebido) ficam de fora.
		expect(Object.keys(byExt).sort()).toEqual(["b-1", "b-2", "b-4", "c-1", "c-2", "c-4"]);
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
			created: 6,
			skipped: { own_transfer: 1, pending: 1, card_payment: 1, refund_without_original: 1 },
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
		// A segunda rodada olha desde 03/10 (12/11 menos 40 dias): os 6 lançamentos já existem.
		expect(second.connections[0]).toMatchObject({ created: 0, existing: 6, status: "ok" });
	});

	it("primeira vez busca 90 dias; depois, desde a última sincronização boa menos 40 dias", async () => {
		await t.run();
		const from = () =>
			t.fake.requests
				.filter((r) => r.url.pathname === "/v2/transactions")
				.map((r) => r.url.searchParams.get("dateFrom"));
		expect(from()).toEqual(["2026-08-14", "2026-08-14"]);
		expect(
			t.fake.requests.find((r) => r.url.pathname === "/v2/transactions")?.url.searchParams.get("dateTo"),
		).toBe("2026-11-12");

		t.fake.requests.length = 0;
		t.setNow(new Date("2026-11-13T09:00:00Z"));
		await t.run();
		expect(from()).toEqual(["2026-10-03", "2026-10-03"]);
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

	it("transferência para o próprio CPF é ignorada mesmo sem categoria", async () => {
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
		const result = await t2.run();
		expect(result.connections[0]?.skipped.own_transfer).toBe(2);
		expect((await everything(t2.stores)).map((r) => r.externalId)).toEqual(["other"]);
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
		expect((await everything(t2.stores)).map((r) => r.externalId).sort()).toEqual(["b-1", "b-2", "b-4"]);
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
});
