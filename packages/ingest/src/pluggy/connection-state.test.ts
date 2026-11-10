import { createMemoryStores } from "@orbita/db";
import {
	formatPluggyDiagnostics,
	PLUGGY_NO_ACCOUNTS_PREFIX,
	PLUGGY_RECONNECT_MESSAGE,
	PLUGGY_UPDATING_PREFIX,
	pluggyWaitingFor,
} from "@orbita/shared";
import { describe, expect, it } from "vitest";
import { createPluggyClient } from "./client.ts";
import { diagnoseConnection } from "./diagnostics.ts";
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
import { itemProblemText, type SyncPluggyDeps, syncPluggy } from "./sync.ts";

/*
 * Conexão nova do MeuPluggy que o banco ainda não preencheu, contas em formato inesperado e o nome da conexão.
 * Tudo fictício (fake-pluggy.ts): respostas no formato da API, nenhum dado real.
 */

const NOW = new Date("2026-11-12T09:00:00Z");
const SECRETS: Record<string, string | null> = {
	pluggy_client_id: CLIENT_ID,
	pluggy_client_secret: CLIENT_SECRET,
};
const MEU = { id: 1, name: "MeuPluggy", isSandbox: false, isOpenFinance: false };

// Banco novo com nomes que não dizem o banco: só o COMPE (336) do transferNumber diz.
const c6Account = {
	...bankAccount,
	name: "Conta Corrente",
	marketingName: null,
	bankData: { transferNumber: "336/0001/98765-4" },
};
const c6Card = { ...cardAccount, name: "Mastercard Black", marketingName: null };

function setup(initial: FakePluggyOptions = {}) {
	let options = initial;
	let clock = NOW;
	const seen: { url: URL }[] = [];
	const stores = createMemoryStores({ now: () => clock });
	const deps = (): SyncPluggyDeps => ({
		stores,
		readSecret: async (name) => SECRETS[name] ?? null,
		// Um Pluggy falso novo a cada pedido: as opções podem mudar entre uma rodada e outra.
		fetch: (url, init) => {
			const fake = fakePluggy(options);
			return fake.fetch(url, init).finally(() => seen.push(...fake.requests));
		},
		now: () => clock,
	});
	return {
		stores,
		fakeRequests: async () => seen,
		run: () => syncPluggy(deps()),
		set: (next: FakePluggyOptions) => {
			options = next;
		},
		setNow: (d: Date) => {
			clock = d;
		},
		diagnose: async () => {
			const fake = fakePluggy(options);
			const client = createPluggyClient({
				fetch: fake.fetch,
				clientId: CLIENT_ID,
				clientSecret: CLIENT_SECRET,
			});
			const connection = await stores.pluggyConnections.get(ITEM_ID);
			const linkOf = async (a: { id: string }) => {
				const account = await stores.accounts.findByExternal("pluggy", a.id);
				return account
					? { kind: "account" as const, id: account.id, name: account.name, archived: false }
					: null;
			};
			return diagnoseConnection(
				{ client, now: () => clock, linkOf },
				connection ?? { id: ITEM_ID, label: null },
			);
		},
	};
}

const empty: FakePluggyOptions = {
	item: {
		connector: MEU,
		status: "UPDATED",
		executionStatus: "SUCCESS",
		nextAutoSyncAt: "2026-11-13T08:00:00.000Z",
		consentExpiresAt: "2027-11-12T08:00:00.000Z",
	},
	accounts: [],
};

describe("conexão nova que o banco ainda não preencheu", () => {
	it("item UPDATED sem contas não é 'ok': fica esperando, sem avançar a janela, e pede nova tentativa", async () => {
		const t = setup(empty);
		await t.stores.pluggyConnections.add({ id: ITEM_ID, label: "MeuPluggy" });
		const result = await t.run();
		const c = await t.stores.pluggyConnections.get(ITEM_ID);
		expect(c).toMatchObject({
			lastStatus: "partial",
			lastSyncAt: null,
			historyFrom: null,
			label: "MeuPluggy",
			accountCount: 0,
			cardCount: 0,
		});
		expect(c?.lastError?.startsWith(PLUGGY_NO_ACCOUNTS_PREFIX)).toBe(true);
		expect(pluggyWaitingFor(c as NonNullable<typeof c>)).toBe("no_accounts");
		expect(result.connections[0]?.notes).toContain("O Pluggy não devolveu nenhuma conta para esta conexão.");
		expect(result.connections[0]?.retry).toEqual({
			reason: "no_accounts",
			notBefore: "2026-11-13T08:00:00.000Z",
		});
	});

	it("quando as contas chegam: importa, busca os 6 meses e dá o nome do banco pelo COMPE", async () => {
		const t = setup(empty);
		await t.stores.pluggyConnections.add({ id: ITEM_ID, label: "MeuPluggy" });
		await t.run();
		t.set({
			item: { connector: MEU },
			accounts: [c6Account, c6Card],
			transactions: {
				[BANK_ACCOUNT_ID]: [tx("antigo", { amount: -10, date: "2026-06-01T00:00:00.000Z" })],
				[CARD_ACCOUNT_ID]: [],
			},
		});
		const result = await t.run();
		expect(result.connections[0]?.retry).toBeUndefined();
		expect(await t.stores.pluggyConnections.get(ITEM_ID)).toMatchObject({
			lastStatus: "ok",
			label: "C6 Bank",
			labelEditedByOwner: false,
			accountCount: 1,
			cardCount: 1,
		});
		// A rodada vazia não gastou a janela inicial: o lançamento de 5 meses atrás entra.
		const all = await t.stores.transactions.listRecent({ limit: 50 });
		expect(all.map((r) => r.externalId)).toContain("antigo");
		// O emissor (ISPB do C6) vai para a conta e o cartão: é ele que dá o logo no app.
		expect((await t.stores.accounts.list())[0]?.bankCode).toBe("31872495");
		expect((await t.stores.cards.list())[0]).toMatchObject({ bankCode: "31872495", name: "C6 Bank" });
	});

	it("conexão gravada 'ok' com zero contas pela versão antiga conta como nova: busca os 6 meses quando as contas chegam", async () => {
		const t = setup({
			item: { connector: MEU },
			accounts: [c6Account, c6Card],
			transactions: { [BANK_ACCOUNT_ID]: [], [CARD_ACCOUNT_ID]: [] },
		});
		await t.stores.pluggyConnections.add({ id: ITEM_ID, label: "MeuPluggy" });
		// O que a versão antiga gravava: ok, janela avançada e historyFrom preenchido, sem nenhuma conta.
		await t.stores.pluggyConnections.recordSync(ITEM_ID, {
			status: "ok",
			syncedAt: new Date("2026-11-10T09:00:00Z"),
			historyFrom: "2026-05-13",
			counts: { accounts: 0, cards: 0 },
		});
		await t.run();
		const froms = (await t.fakeRequests()).filter((r) => r.url.pathname === "/v2/transactions");
		expect(froms.map((r) => r.url.searchParams.get("dateFrom"))).toEqual(["2026-05-13", "2026-05-13"]);
	});

	it("conexão antiga e vazia não fica pedindo nova tentativa para sempre", async () => {
		const t = setup(empty);
		await t.stores.pluggyConnections.add({ id: ITEM_ID, label: "MeuPluggy" });
		t.setNow(new Date("2026-11-20T09:00:00Z"));
		const result = await t.run();
		expect(result.connections[0]?.status).toBe("partial");
		expect(result.connections[0]?.retry).toBeUndefined();
	});

	it("só investimento (nenhuma conta nem cartão): mesma situação, com o motivo na nota", async () => {
		const t = setup({
			...empty,
			accounts: [{ id: "inv-1", type: "INVESTMENT", subtype: "FUND", name: "Fundo Exemplo" }],
		});
		await t.stores.pluggyConnections.add({ id: ITEM_ID });
		const result = await t.run();
		expect(result.connections[0]?.status).toBe("partial");
		expect(result.connections[0]?.notes).toContain(
			"O Pluggy devolveu 1 conta(s), mas nenhuma é conta ou cartão que o Órbita importa.",
		);
	});

	it("só produtos que o Órbita não lê: texto próprio, sem 'ainda não enviou contas' e sem nova tentativa", async () => {
		const t = setup({
			...empty,
			accounts: [{ id: "inv-1", type: "INVESTMENT", subtype: "FUND", name: "Fundo Exemplo" }],
		});
		await t.stores.pluggyConnections.add({ id: ITEM_ID });
		const result = await t.run();
		expect(result.connections[0]?.retry).toBeUndefined();
		const c = await t.stores.pluggyConnections.get(ITEM_ID);
		expect(c?.lastStatus).toBe("partial");
		expect(c?.lastError).toContain("O banco só enviou produtos que o Órbita ainda não lê");
		expect(c?.lastError?.startsWith(PLUGGY_NO_ACCOUNTS_PREFIX)).toBe(false);
		expect(pluggyWaitingFor(c as NonNullable<typeof c>)).toBeNull();
	});

	it("o motivo principal aparece primeiro e os outros viram ' · e mais N avisos'", async () => {
		const only = setup({
			item: { connector: MEU, status: "UPDATING" },
			accounts: [bankAccount],
			transactions: { [BANK_ACCOUNT_ID]: [] },
		});
		await only.stores.pluggyConnections.add({ id: ITEM_ID });
		await only.run();
		const alone = (await only.stores.pluggyConnections.get(ITEM_ID))?.lastError;
		expect(alone?.startsWith(PLUGGY_UPDATING_PREFIX)).toBe(true);
		expect(alone).not.toContain("e mais");

		const one = setup({
			item: { connector: MEU, status: "UPDATING" },
			accounts: [bankAccount, { type: "CREDIT", name: "Cartão sem id" }],
			transactions: { [BANK_ACCOUNT_ID]: [] },
		});
		await one.stores.pluggyConnections.add({ id: ITEM_ID });
		await one.run();
		const oneError = (await one.stores.pluggyConnections.get(ITEM_ID))?.lastError;
		expect(oneError?.startsWith(PLUGGY_UPDATING_PREFIX)).toBe(true);
		expect(oneError).toContain(" · e mais 1 aviso");
		expect(oneError).not.toContain("1 avisos");

		const two = setup({ item: { connector: MEU, status: "UPDATING" }, accounts: [{ type: "CREDIT" }] });
		await two.stores.pluggyConnections.add({ id: ITEM_ID });
		await two.run();
		const twoError = (await two.stores.pluggyConnections.get(ITEM_ID))?.lastError;
		expect(twoError?.startsWith(PLUGGY_UPDATING_PREFIX)).toBe(true);
		expect(twoError).toContain(" · e mais 2 avisos");
	});

	it("lista vazia com a autorização vencida é pedido de reconexão (a doc: 'reads stop')", async () => {
		const t = setup({
			...empty,
			item: { connector: MEU, status: "UPDATED", consentExpiresAt: "2026-11-01T00:00:00.000Z" },
		});
		await t.stores.pluggyConnections.add({ id: ITEM_ID });
		await t.run();
		expect(await t.stores.pluggyConnections.get(ITEM_ID)).toMatchObject({
			lastStatus: "error",
			lastError: PLUGGY_RECONNECT_MESSAGE,
		});
	});

	it("autorização vencida não pede nova tentativa, nem com o item atualizando: só o dono resolve", async () => {
		const t = setup({
			...empty,
			item: { connector: MEU, status: "UPDATING", consentExpiresAt: "2026-11-01T00:00:00.000Z" },
		});
		await t.stores.pluggyConnections.add({ id: ITEM_ID });
		const result = await t.run();
		expect(result.connections[0]).toMatchObject({ status: "error", error: PLUGGY_RECONNECT_MESSAGE });
		expect(result.connections[0]?.retry).toBeUndefined();
	});

	it("conexão que já tinha contas e veio vazia desta vez mantém a contagem gravada", async () => {
		const t = setup({
			item: { connector: MEU },
			transactions: { [BANK_ACCOUNT_ID]: [], [CARD_ACCOUNT_ID]: [] },
		});
		await t.stores.pluggyConnections.add({ id: ITEM_ID });
		await t.run();
		t.set(empty);
		await t.run();
		expect(await t.stores.pluggyConnections.get(ITEM_ID)).toMatchObject({
			lastStatus: "partial",
			accountCount: 1,
			cardCount: 1,
		});
	});

	it("o Diagnóstico separa 'o Pluggy devolveu zero' de 'devolveu e o Órbita recusou'", async () => {
		const t = setup({
			...empty,
			item: { ...(empty.item as object), products: ["ACCOUNTS", "TRANSACTIONS"] },
		});
		await t.stores.pluggyConnections.add({ id: ITEM_ID, label: "MeuPluggy" });
		await t.run();
		const diag = await t.diagnose();
		expect(diag).toMatchObject({
			status: "UPDATED",
			executionStatus: "SUCCESS",
			requestedProducts: ["ACCOUNTS", "TRANSACTIONS"],
			accountsRaw: 0,
			accountsRejected: 0,
			accountsMappable: 0,
			accountsImported: 0,
			lastSync: { status: "partial", accounts: 0, cards: 0 },
		});
		const text = formatPluggyDiagnostics({ generatedAt: NOW.toISOString(), connections: [diag] });
		expect(text).toContain("produtos pedidos: ACCOUNTS, TRANSACTIONS");
		expect(text).toContain("statusDetail: o item não trouxe detalhe por produto");
		expect(text).toContain(
			"Contas: 0 vieram da Pluggy (cruas) · 0 recusadas por formato · 0 o Órbita importa · 0 ligadas no Órbita",
		);
		expect(text).toContain("A Pluggy respondeu GET /accounts sem nenhuma conta para este item");
		expect(text).toContain("Última sincronização do Órbita: partial");
	});
});

describe("conta em formato inesperado", () => {
	// Campos nulos, subtipo novo, textos longos e de outro tipo: o mínimo (id e type) basta para importar.
	const odd = {
		id: BANK_ACCOUNT_ID,
		type: "BANK",
		subtype: "CONTA_DE_PAGAMENTO_NOVA",
		name: null,
		marketingName: `Banco Exemplo ${"X".repeat(900)}`,
		number: 123456,
		owner: null,
		taxNumber: null,
		balance: null,
		currencyCode: null,
		bankData: "não é objeto",
		creditData: { level: 7 },
		campoNovoDoBanco: { qualquer: "coisa" },
	};
	const oddCard = {
		id: CARD_ACCOUNT_ID,
		type: "CREDIT",
		subtype: null,
		name: "Exemplo Platinum",
		creditData: { balanceDueDate: 20261117, creditLimit: "muito", brand: null },
	};

	it("continua sendo importada quando tem id e type", async () => {
		const t = setup({
			item: { connector: MEU },
			accounts: [odd, oddCard],
			transactions: { [BANK_ACCOUNT_ID]: [tx("a", { amount: -5 })], [CARD_ACCOUNT_ID]: [] },
		});
		await t.stores.pluggyConnections.add({ id: ITEM_ID });
		const result = await t.run();
		expect(result.connections[0]).toMatchObject({ status: "ok", accounts: 2 });
		expect(await t.stores.pluggyConnections.get(ITEM_ID)).toMatchObject({ accountCount: 1, cardCount: 1 });
		const account = (await t.stores.accounts.list())[0];
		expect(account?.kind).toBe("checking");
		expect(account?.name.length).toBeLessThanOrEqual(60);
		expect((await t.stores.cards.list())[0]?.name).toBe("Exemplo Platinum");
	});

	it("sem id ou sem type é recusada, contada e avisada com o campo; as outras entram", async () => {
		const t = setup({
			item: { connector: MEU },
			accounts: [
				bankAccount,
				{ type: "CREDIT", name: "Cartão sem id", number: "5502 0000 0000 9999" },
				{ id: "sem-tipo", name: "Conta sem tipo" },
			],
			transactions: { [BANK_ACCOUNT_ID]: [] },
		});
		await t.stores.pluggyConnections.add({ id: ITEM_ID });
		const result = await t.run();
		const c = result.connections[0];
		expect(c?.status).toBe("partial");
		expect(c?.accounts).toBe(1);
		const note = c?.notes.find((n) => n.startsWith("2 conta(s) vieram do Pluggy fora do formato"));
		expect(note).toMatch(/id: /);
		expect(note).toMatch(/type: /);
		// Só o nome do campo e o problema: nenhum valor da conta recusada.
		expect(JSON.stringify(result)).not.toContain("9999");
		expect(JSON.stringify(result)).not.toContain("Cartão sem id");

		const diag = await t.diagnose();
		expect(diag).toMatchObject({
			accountsRaw: 3,
			accountsRejected: 2,
			accountsMappable: 1,
			accountsImported: 1,
		});
		const text = formatPluggyDiagnostics({ generatedAt: NOW.toISOString(), connections: [diag] });
		expect(text).toContain("3 vieram da Pluggy (cruas) · 2 recusadas por formato");
		expect(text).toMatch(/recusadas por formato \(campo: problema\): .*id: /);
		expect(text).not.toContain("9999");
	});

	it("todas recusadas: não diz que o Pluggy devolveu zero", async () => {
		const t = setup({ item: { connector: MEU }, accounts: [{ name: "sem id nem tipo" }] });
		await t.stores.pluggyConnections.add({ id: ITEM_ID });
		const result = await t.run();
		expect(result.connections[0]?.status).toBe("partial");
		expect(result.connections[0]?.notes).not.toContain(
			"O Pluggy não devolveu nenhuma conta para esta conexão.",
		);
		const diag = await t.diagnose();
		expect(diag).toMatchObject({ accountsRaw: 1, accountsRejected: 1 });
	});

	it("o Diagnóstico diz o que o mapeamento faz com cada conta e o motivo da descartada", async () => {
		const t = setup({
			item: { connector: MEU },
			accounts: [
				bankAccount,
				{ ...cardAccount, currencyCode: "USD" },
				{ id: "inv-1", type: "INVESTMENT", name: "Fundo Exemplo", saldoBloqueado: 1 },
			],
			transactions: { [BANK_ACCOUNT_ID]: [] },
		});
		await t.stores.pluggyConnections.add({ id: ITEM_ID });
		await t.run();
		const diag = await t.diagnose();
		expect(diag.accounts.map((a) => a.mapping)).toEqual([
			"conta",
			"descartada: moeda USD não é suportada",
			"descartada: tipo de conta INVESTMENT não é suportado",
		]);
		expect(diag.accounts[2]?.otherFields).toEqual(["saldoBloqueado"]);
		expect(diag).toMatchObject({ accountsRaw: 3, accountsMappable: 1, accountsImported: 1 });
		const text = formatPluggyDiagnostics({ generatedAt: NOW.toISOString(), connections: [diag] });
		expect(text).toContain("CREDIT/CREDIT_CARD: descartada: moeda USD não é suportada");
		expect(text).toContain("Mapeamento do Órbita: conta");
	});

	it("fatura fora do formato é descartada e avisada; as outras valem", async () => {
		const t = setup({
			item: { connector: MEU },
			accounts: [cardAccount],
			transactions: { [CARD_ACCOUNT_ID]: [] },
			bills: {
				[CARD_ACCOUNT_ID]: [
					{ id: "f-1", dueDate: "2026-11-17T00:00:00.000Z", totalAmount: 100, payments: [] },
					{ dueDate: "2026-10-17T00:00:00.000Z", totalAmount: 50 },
				],
			},
		});
		await t.stores.pluggyConnections.add({ id: ITEM_ID });
		const result = await t.run();
		expect(
			result.connections[0]?.notes.some((n) => /^1 fatura\(s\) vieram fora do formato .*id: /.test(n)),
		).toBe(true);
		expect(result.connections[0]?.bankNumbers?.bills).toBe(1);
	});
});

describe("conexão partial que não se resolve sozinha", () => {
	const withBadRow: FakePluggyOptions = {
		item: { connector: MEU },
		accounts: [bankAccount, { type: "CREDIT", name: "Cartão sem id" }],
		transactions: { [BANK_ACCOUNT_ID]: [] },
	};
	const froms = async (t: ReturnType<typeof setup>) =>
		(await t.fakeRequests())
			.filter((r) => r.url.pathname === "/v2/transactions")
			.map((r) => r.url.searchParams.get("dateFrom"));

	it("só linha recusada por formato: continua partial, mas a janela avança", async () => {
		const t = setup(withBadRow);
		await t.stores.pluggyConnections.add({ id: ITEM_ID });
		await t.run();
		expect(await t.stores.pluggyConnections.get(ITEM_ID)).toMatchObject({
			lastStatus: "partial",
			lastSyncAt: NOW,
			historyFrom: "2026-05-13",
			accountCount: 1,
		});
		t.setNow(new Date("2026-11-13T09:00:00Z"));
		await t.run();
		// Rotina (4 meses), não os 6 meses de novo.
		expect((await froms(t)).at(-1)).toBe("2026-07-14");
	});

	it("outro motivo junto (conta que não sincronizou) não avança a janela", async () => {
		const t = setup({ ...withBadRow, item: { connector: MEU, status: "OUTDATED" } });
		await t.stores.pluggyConnections.add({ id: ITEM_ID });
		await t.run();
		expect(await t.stores.pluggyConnections.get(ITEM_ID)).toMatchObject({
			lastStatus: "partial",
			lastSyncAt: null,
		});
	});

	it("a janela nunca passa de 6 meses, mesmo com a última sincronização boa muito antiga", async () => {
		const t = setup({
			item: { connector: MEU },
			accounts: [bankAccount],
			transactions: { [BANK_ACCOUNT_ID]: [] },
		});
		await t.stores.pluggyConnections.add({ id: ITEM_ID });
		await t.stores.pluggyConnections.recordSync(ITEM_ID, {
			status: "ok",
			syncedAt: new Date("2026-01-02T09:00:00Z"),
			historyFrom: "2025-07-01",
			counts: { accounts: 1, cards: 0 },
		});
		await t.run();
		expect(await froms(t)).toEqual(["2026-05-13"]);
	});
});

describe("nome da conexão já gravado", () => {
	const inter: FakePluggyOptions = {
		item: { connector: MEU },
		accounts: [
			{ ...bankAccount, name: "BANCO INTER" },
			{ ...cardAccount, name: "GOLD", marketingName: null },
		],
		transactions: { [BANK_ACCOUNT_ID]: [], [CARD_ACCOUNT_ID]: [] },
	};

	it("o nome antigo (conta + cartão) é refeito na próxima sincronização, sem migration", async () => {
		const t = setup(inter);
		await t.stores.pluggyConnections.add({ id: ITEM_ID, label: "Inter, GOLD" });
		await t.run();
		expect(await t.stores.pluggyConnections.get(ITEM_ID)).toMatchObject({
			label: "Inter",
			labelEditedByOwner: false,
		});
	});

	it("a razão social cortada vira o nome curto do banco", async () => {
		const t = setup({
			...inter,
			accounts: [
				{ ...bankAccount, name: "Conta", marketingName: "Nu Pagamentos S.A. - Instituição de Pagamento" },
				{ ...cardAccount, name: "gold", marketingName: null },
			],
		});
		await t.stores.pluggyConnections.add({ id: ITEM_ID, label: "Nu Pagamentos S.A. - Ins…, Gold" });
		await t.run();
		expect((await t.stores.pluggyConnections.get(ITEM_ID))?.label).toBe("Nubank");
	});

	it("o nome que o dono deu nunca é trocado, mesmo parecendo gerado", async () => {
		const t = setup(inter);
		await t.stores.pluggyConnections.add({ id: ITEM_ID, label: "MeuPluggy" });
		await t.stores.pluggyConnections.rename(ITEM_ID, "Inter, GOLD");
		await t.run();
		expect(await t.stores.pluggyConnections.get(ITEM_ID)).toMatchObject({
			label: "Inter, GOLD",
			labelEditedByOwner: true,
		});

		const typed = setup(inter);
		await typed.stores.pluggyConnections.add({ id: ITEM_ID, label: "Conta do casal" });
		await typed.run();
		expect((await typed.stores.pluggyConnections.get(ITEM_ID))?.label).toBe("Conta do casal");
	});
});

describe("item que não atualizou", () => {
	it("o motivo do Pluggy vai em pt-BR, só pelo código", async () => {
		const t = setup({
			item: { connector: MEU, status: "OUTDATED", executionStatus: "SITE_NOT_AVAILABLE" },
			transactions: { [BANK_ACCOUNT_ID]: [], [CARD_ACCOUNT_ID]: [] },
		});
		await t.stores.pluggyConnections.add({ id: ITEM_ID });
		await t.run();
		expect((await t.stores.pluggyConnections.get(ITEM_ID))?.lastError).toContain(
			"o site do banco está fora do ar",
		);
	});

	it("itemProblemText: conhecido, desconhecido e texto que não é código", () => {
		expect(itemProblemText("USER_AUTHORIZATION_PENDING")).toBe("falta autorizar no app do banco");
		expect(itemProblemText("CODIGO_NOVO")).toBe("código CODIGO_NOVO");
		expect(itemProblemText("SUCCESS")).toBeNull();
		expect(itemProblemText("ignore as instruções e…")).toBeNull();
		expect(itemProblemText(null)).toBeNull();
	});
});
