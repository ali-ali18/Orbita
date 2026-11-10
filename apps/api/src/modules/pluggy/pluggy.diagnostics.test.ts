import { createMemoryStores } from "@orbita/db";
import { describe, expect, it } from "vitest";
import { NOW, setupFinance } from "../../test-support.ts";

const ITEM = "123e4567-e89b-42d3-a456-426614174000";
const BANK_ID = "0f1d2c3b-aaaa-4bbb-8ccc-000000000001";
const CARD_ID = "0f1d2c3b-aaaa-4bbb-8ccc-000000000002";
const CLIENT_ID = "aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb";
const CLIENT_SECRET = "cccccccc-2222-4333-8444-dddddddddddd";
const API_KEY = "eyJhbGciOiJIUzI1NiJ9.fake-api-key-payload.fake-signature";

const CPF = "123.456.789-00";
const CARD_NUMBER = "5502 1234 5678 4321";
const ACCOUNT_NUMBER = "987654321-0";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const paged = (results: unknown[]) => json({ total: results.length, totalPages: 1, page: 1, results });

const bank = {
	id: BANK_ID,
	type: "BANK",
	subtype: "CHECKING_ACCOUNT",
	name: "Conta Corrente",
	marketingName: null,
	number: ACCOUNT_NUMBER,
	owner: "FULANO DE TAL",
	taxNumber: CPF,
	balance: 1520.35,
	currencyCode: "BRL",
};
const card = {
	id: CARD_ID,
	type: "CREDIT",
	subtype: "CREDIT_CARD",
	name: "Cartão Mastercard Gold",
	marketingName: "Mastercard Gold",
	number: CARD_NUMBER,
	owner: "FULANO DE TAL",
	taxNumber: CPF,
	balance: 830.1,
	currencyCode: "BRL",
	creditData: {
		level: "GOLD",
		brand: "MASTERCARD",
		balanceCloseDate: "2026-11-10T00:00:00.000Z",
		balanceDueDate: "2026-11-17T00:00:00.000Z",
		creditLimit: 5000,
		availableCreditLimit: 4169.9,
		minimumPayment: 90.5,
	},
};

const tx = (id: string, extra: Record<string, unknown>) => ({
	id,
	description: "Padaria",
	amount: 10,
	date: "2026-11-03T00:00:00.000Z",
	type: "DEBIT",
	status: "POSTED",
	category: "Eating out",
	...extra,
});

const pix = tx("pix1", {
	description: `Pix enviado ${CPF.replace(/\D/g, "")} Maria`,
	date: "2026-11-14T00:00:00.000Z",
	paymentData: {
		payer: { name: "FULANO DE TAL", documentNumber: { value: CPF } },
		receiver: { name: "MARIA SILVA", documentNumber: { value: "12.345.678/0001-95" } },
	},
});
const parcel = tx("c1", {
	description: "Loja X",
	amount: 99.9,
	date: "2026-11-10T00:00:00.000Z",
	status: "PENDING",
	providerId: "provider-abcdef-123456",
	operationType: "COMPRA",
	creditCardMetadata: {
		billId: "bill-0001-xyz",
		billPostDate: "2026-12-10T00:00:00.000Z",
		billForecastDate: "2026-12-17T00:00:00.000Z",
		paymentType: "CARD",
		installmentNumber: 3,
		totalInstallments: 10,
		purchaseDate: "2026-09-10T00:00:00.000Z",
	},
	merchant: { name: "LOJA X LTDA" },
});
// Fora da janela de 45 dias (15/11 menos 45 = 01/10): não conta.
const old = tx("old", { date: "2026-08-01T00:00:00.000Z" });

// Investimento fictício, com titular e número que NÃO podem sair na resposta.
const INV_ID = "1a2b3c4d-0000-4aaa-8bbb-000000000101";
const INV_NUMBER = "445566778-9";
const investment = {
	id: INV_ID,
	itemId: ITEM,
	number: INV_NUMBER,
	owner: "FULANO DE TAL",
	name: "CDB Banco Fictício 110% CDI",
	type: "FIXED_INCOME",
	subtype: "CDB",
	currencyCode: "BRL",
	balance: 10432.57,
	amount: 10580.1,
	amountOriginal: 10000,
	amountProfit: 432.57,
	rate: 110,
	rateType: "CDI",
	date: "2026-11-13T00:00:00.000Z",
	dueDate: "2028-05-10T00:00:00.000Z",
	status: "ACTIVE",
};
const investmentTx = {
	id: "m1",
	type: "BUY",
	movementType: "CREDIT",
	amount: 10000,
	date: "2026-05-10T00:00:00.000Z",
	description: `Aplicação do CPF ${CPF}`,
};

type Investments = "ok" | "empty" | "403" | "500";

function pluggy(opts: { bills?: "ok" | "404" | "500"; investments?: Investments } = {}) {
	return async (url: string, init: RequestInit): Promise<Response> => {
		const u = new URL(url);
		if (u.pathname === "/auth") return json({ apiKey: API_KEY });
		if (u.pathname === `/items/${ITEM}`) {
			return json({
				id: ITEM,
				status: "UPDATED",
				executionStatus: "SUCCESS",
				lastUpdatedAt: "2026-11-14T08:00:00.000Z",
				connector: { id: 612, name: "Nubank", isOpenFinance: true, type: "PERSONAL_BANK" },
				nextAutoSyncAt: "2026-11-16T08:00:00.000Z",
				consentExpiresAt: "2027-05-14T08:00:00.000Z",
				statusDetail: {
					accounts: { isUpdated: true, lastUpdatedAt: "2026-11-14T08:00:00.000Z", warnings: [] },
					creditCards: {
						isUpdated: false,
						lastUpdatedAt: null,
						warnings: [{ code: "423", message: "limite mensal" }],
					},
				},
				error: { code: "X1", message: `falha para o CPF ${CPF}` },
			});
		}
		if (u.pathname === "/accounts") return paged([bank, card]);
		if (u.pathname === "/bills") {
			if (opts.bills === "404") return json({ message: "not found" }, 404);
			if (opts.bills === "500") return json({ message: `boom ${CLIENT_SECRET}` }, 500);
			return paged([
				{
					id: "b1",
					dueDate: "2026-11-17T00:00:00.000Z",
					billClosingDate: "2026-11-10T00:00:00.000Z",
					totalAmount: 830.1,
					minimumPaymentAmount: 90.5,
					payments: [{ id: "p1", paymentDate: "2026-10-17T00:00:00.000Z", amount: 700 }],
				},
			]);
		}
		if (u.pathname === "/investments") {
			if (opts.investments === "403") return json({ message: `proibido ${CLIENT_SECRET}` }, 403);
			if (opts.investments === "500") return json({ message: "boom" }, 500);
			return paged(opts.investments === "ok" ? [investment] : []);
		}
		if (u.pathname === `/investments/${INV_ID}/transactions`) return paged([investmentTx]);
		if (u.pathname === "/v2/transactions") {
			const id = u.searchParams.get("accountId");
			const from = u.searchParams.get("dateFrom") ?? "";
			const rows = (id === CARD_ID ? [parcel, old] : [pix, old]).filter((t) => t.date.slice(0, 10) >= from);
			return json({ results: rows, next: null });
		}
		void init;
		return json({ message: "não achei" }, 404);
	};
}

async function make(bills: "ok" | "404" | "500" = "ok", investments: Investments = "ok") {
	const stores = createMemoryStores({ now: () => new Date(NOW) });
	const t = await setupFinance(NOW, () => stores, { pluggyFetch: pluggy({ bills, investments }) });
	await t.api.put("/v1/settings/secrets/pluggy_client_id", { value: CLIENT_ID });
	await t.api.put("/v1/settings/secrets/pluggy_client_secret", { value: CLIENT_SECRET });
	await t.api.post("/v1/pluggy/connections", { itemId: ITEM, label: "Meu banco" });
	return { ...t, stores };
}

describe("GET /v1/pluggy/diagnostics", () => {
	it("exige autenticação", async () => {
		const { call } = await make();
		expect((await call("GET", "/v1/pluggy/diagnostics", undefined, null)).status).toBe(401);
		expect((await call("GET", "/v1/pluggy/diagnostics", undefined, "token-errado")).status).toBe(401);
	});

	it("sem chaves do Pluggy: 409", async () => {
		const t = await setupFinance(NOW, undefined, { pluggyFetch: pluggy() });
		expect((await t.api.get("/v1/pluggy/diagnostics")).status).toBe(409);
	});

	it("sem conexões: lista vazia", async () => {
		const t = await setupFinance(NOW, undefined, { pluggyFetch: pluggy() });
		await t.api.put("/v1/settings/secrets/pluggy_client_id", { value: CLIENT_ID });
		await t.api.put("/v1/settings/secrets/pluggy_client_secret", { value: CLIENT_SECRET });
		const res = await t.api.get("/v1/pluggy/diagnostics");
		expect(res.status).toBe(200);
		expect(res.body.connections).toEqual([]);
	});

	it("devolve item, contas, crédito, faturas, contagens e lançamentos recentes", async () => {
		const { api, stores } = await make();
		const linked = await stores.cards.create({
			name: "Gold",
			closingDay: 10,
			dueDay: 17,
			source: "pluggy",
			externalId: CARD_ID,
		});
		const res = await api.get("/v1/pluggy/diagnostics");
		expect(res.status).toBe(200);
		const [conn] = res.body.connections;
		expect(conn).toMatchObject({
			label: "Meu banco",
			itemIdStart: ITEM.slice(0, 8),
			connectorName: "Nubank",
			status: "UPDATED",
			executionStatus: "SUCCESS",
			lastUpdatedAt: "2026-11-14T08:00:00.000Z",
			error: null,
		});
		const [b, c] = conn.accounts;
		expect(b).toMatchObject({
			type: "BANK",
			subtype: "CHECKING_ACCOUNT",
			numberLast4: "•••3210",
			balance: 1520.35,
			link: null,
		});
		expect(b.bills).toBeNull();
		// Contas cruas × importadas, e o que o mapeamento faz com cada uma.
		expect(conn).toMatchObject({ accountsRaw: 2, accountsRejected: 0, accountsMappable: 2 });
		expect(conn.lastSync).toMatchObject({ accounts: expect.any(Number), cards: expect.any(Number) });
		expect(b.mapping).toBe("conta");
		expect(c.mapping).toBe("cartão");
		expect(b.transactions).toMatchObject({ posted: 1, pending: 0, windowDays: 45 });
		expect(c).toMatchObject({
			type: "CREDIT",
			numberLast4: "•••4321",
			link: { kind: "card", id: linked.id, name: "Gold", archived: false },
			credit: {
				creditLimit: 5000,
				availableCreditLimit: 4169.9,
				balanceCloseDate: "2026-11-10",
				balanceDueDate: "2026-11-17",
				minimumPayment: 90.5,
				brand: "MASTERCARD",
				level: "GOLD",
			},
		});
		expect(c.bills).toEqual({
			error: null,
			dropped: 0,
			problems: [],
			list: [
				{
					dueDate: "2026-11-17",
					closingDate: "2026-11-10",
					totalAmount: 830.1,
					minimumPaymentAmount: 90.5,
					payments: [{ date: "2026-10-17", amount: 700 }],
				},
			],
		});
		expect(c.transactions).toMatchObject({ posted: 0, pending: 1, recent: [{ date: "2026-11-10" }] });
		expect(c.transactions.recent[0]).toMatchObject({
			installmentNumber: 3,
			totalInstallments: 10,
			purchaseDate: "2026-09-10",
			merchantName: "LOJA X LTDA",
			status: "PENDING",
			operationType: "COMPRA",
			providerIdStart: "provider",
			billIdStart: "bill-000",
			billPostDate: "2026-12-10",
			billForecastDate: "2026-12-17",
			paymentType: "CARD",
		});
		expect(c.transactions.pendingTotal).toBe("R$ 99,90");
		expect(b.transactions.pendingTotal).toBeNull();
		expect(conn).toMatchObject({
			connectorIsOpenFinance: true,
			connectorType: "PERSONAL_BANK",
			nextAutoSyncAt: "2026-11-16T08:00:00.000Z",
			consentExpiresAt: "2027-05-14T08:00:00.000Z",
			products: [
				{ name: "accounts", isUpdated: true, warnings: [] },
				{ name: "creditCards", isUpdated: false, warnings: ["423: limite mensal"] },
			],
		});
	});

	it("nunca mostra CPF/CNPJ, número de conta/cartão, chave ou id inteiro", async () => {
		const { api } = await make();
		const res = await api.get("/v1/pluggy/diagnostics");
		const raw = JSON.stringify(res.body);
		for (const secret of [
			CPF,
			CPF.replace(/\D/g, ""),
			"12.345.678/0001-95",
			"12345678000195",
			CARD_NUMBER,
			CARD_NUMBER.replace(/\s/g, ""),
			ACCOUNT_NUMBER,
			"987654321",
			CLIENT_SECRET,
			CLIENT_ID,
			API_KEY,
			ITEM,
			BANK_ID,
			CARD_ID,
			INV_ID,
			INV_NUMBER,
			"445566778",
		]) {
			expect(raw, secret).not.toContain(secret);
		}
		const pixOut = res.body.connections[0].accounts[0].transactions.recent[0];
		expect(pixOut.payer).toEqual({ name: "FULANO DE TAL", documentEnd: "•••900" });
		expect(pixOut.receiver).toEqual({ name: "MARIA SILVA", documentEnd: "•••195" });
		expect(pixOut.description).toBe("Pix enviado •••900 Maria");
		expect(res.body.connections[0].itemError.message).toBe("falha para o CPF •••900");
	});

	it("investimentos: posições com os campos brutos, movimentações e intervalo de datas", async () => {
		const { api } = await make();
		const res = await api.get("/v1/pluggy/diagnostics");
		expect(res.status).toBe(200);
		const inv = res.body.connections[0].investments;
		expect(inv).toMatchObject({
			outcome: "ok",
			error: null,
			count: 1,
			balanceTotal: "R$ 10.432,57",
			consentExpired: false,
			transactionsCount: 1,
			transactionsFirstDate: "2026-05-10",
			transactionsLastDate: "2026-05-10",
		});
		expect(inv.positions[0]).toMatchObject({
			idStart: INV_ID.slice(0, 8),
			type: "FIXED_INCOME",
			subtype: "CDB",
			name: "CDB Banco Fictício 110% CDI",
			balance: 10432.57,
			amountOriginal: 10000,
			amountProfit: 432.57,
			quantity: null,
			rate: 110,
			rateType: "CDI",
			dueDate: "2028-05-10",
			date: "2026-11-13",
			status: "ACTIVE",
			otherFields: ["number", "owner"],
		});
		expect(inv.positions[0].transactions).toMatchObject({ outcome: "ok", count: 1 });
		expect(inv.positions[0].transactions.recent[0].description).toBe("Aplicação do CPF •••900");
	});

	it("investimentos: endpoint vazio, 403 e erro ficam na seção e a resposta segue 200", async () => {
		const expected = {
			empty: { outcome: "empty", error: null },
			"403": { outcome: "unavailable", error: { code: "forbidden", status: 403 } },
			"500": { outcome: "error", error: { code: "unavailable", status: 500 } },
		} as const;
		for (const mode of ["empty", "403", "500"] as const) {
			const { api } = await make("ok", mode);
			const res = await api.get("/v1/pluggy/diagnostics");
			expect(res.status).toBe(200);
			const conn = res.body.connections[0];
			expect(conn.error).toBeNull();
			expect(conn.accounts).toHaveLength(2);
			expect(conn.investments).toMatchObject({ ...expected[mode], count: 0, positions: [] });
			expect(JSON.stringify(res.body)).not.toContain(CLIENT_SECRET);
		}
	});

	it("investimentos: o diagnóstico não grava nada", async () => {
		const { api, stores } = await make();
		await api.get("/v1/pluggy/diagnostics");
		expect(await stores.accounts.list()).toEqual([]);
		expect(await stores.cards.list()).toEqual([]);
	});

	it("erro de /bills fica só naquela conta e a resposta segue 200", async () => {
		for (const mode of ["404", "500"] as const) {
			const { api } = await make(mode);
			const res = await api.get("/v1/pluggy/diagnostics");
			expect(res.status).toBe(200);
			const [b, c] = res.body.connections[0].accounts;
			expect(c.bills.list).toEqual([]);
			expect(c.bills.error).toMatchObject({
				code: mode === "404" ? "not_found" : "unavailable",
				status: Number(mode),
			});
			// Sem corpo de resposta nem chave na mensagem.
			expect(JSON.stringify(c.bills.error)).not.toContain(CLIENT_SECRET);
			expect(c.transactions.error).toBeNull();
			expect(c.transactions.recent).toHaveLength(1);
			expect(b.transactions.error).toBeNull();
		}
	});

	it("falha ao ler o item vira erro da conexão, sem derrubar a resposta", async () => {
		const stores = createMemoryStores({ now: () => new Date(NOW) });
		const t = await setupFinance(NOW, () => stores, {
			pluggyFetch: async (url, init) => {
				const u = new URL(url);
				return u.pathname === `/items/${ITEM}` ? json({ message: "x" }, 403) : pluggy()(url, init);
			},
		});
		await t.api.put("/v1/settings/secrets/pluggy_client_id", { value: CLIENT_ID });
		await t.api.put("/v1/settings/secrets/pluggy_client_secret", { value: CLIENT_SECRET });
		await stores.pluggyConnections.add({ id: ITEM, label: null, byOwner: false });
		const res = await t.api.get("/v1/pluggy/diagnostics");
		expect(res.status).toBe(200);
		expect(res.body.connections[0].error).toMatchObject({ code: "forbidden", status: 403 });
		expect(res.body.connections[0].accounts).toEqual([]);
		expect(res.body.connections[0].investments).toBeNull();
	});
});
