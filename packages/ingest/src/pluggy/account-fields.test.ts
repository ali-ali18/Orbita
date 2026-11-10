import { createMemoryStores } from "@orbita/db";
import { formatPluggyDiagnostics } from "@orbita/shared";
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
} from "./fake-pluggy.ts";
import { mapPluggyAccount } from "./mapping.ts";
import { accountSchema } from "./schemas.ts";
import { type SyncPluggyDeps, syncPluggy } from "./sync.ts";

/*
 * Campo presente com tipo errado não some em silêncio: moeda ilegível recusa a conta; os outros campos viram `null`
 * (ou são cortados) e ficam em `fieldProblems`. Tudo fictício; os problemas guardam só campo e código, nunca o valor.
 */

const NOW = new Date("2026-11-12T09:00:00Z");
const MEU = { id: 1, name: "MeuPluggy", isSandbox: false, isOpenFinance: false };
const SECRETS: Record<string, string | null> = {
	pluggy_client_id: CLIENT_ID,
	pluggy_client_secret: CLIENT_SECRET,
};

function setup(initial: FakePluggyOptions) {
	let options = initial;
	const stores = createMemoryStores({ now: () => NOW });
	const deps = (): SyncPluggyDeps => ({
		stores,
		readSecret: async (name) => SECRETS[name] ?? null,
		fetch: (url, init) => fakePluggy(options).fetch(url, init),
		now: () => NOW,
	});
	return {
		stores,
		run: () => syncPluggy(deps()),
		set: (next: FakePluggyOptions) => {
			options = next;
		},
		diagnose: async () => {
			const client = createPluggyClient({
				fetch: fakePluggy(options).fetch,
				clientId: CLIENT_ID,
				clientSecret: CLIENT_SECRET,
			});
			const connection = await stores.pluggyConnections.get(ITEM_ID);
			return diagnoseConnection(
				{ client, now: () => NOW, linkOf: async () => null },
				connection ?? { id: ITEM_ID, label: null },
			);
		},
	};
}

describe("currencyCode: ausente vale BRL, presente e ilegível recusa", () => {
	it("ausente e null passam (como sempre); número é recusado com o motivo", () => {
		const { currencyCode: _omit, ...withoutCurrency } = bankAccount;
		expect(accountSchema.safeParse(withoutCurrency).success).toBe(true);
		expect(accountSchema.safeParse({ ...bankAccount, currencyCode: null }).success).toBe(true);
		const bad = accountSchema.safeParse({ ...bankAccount, currencyCode: 986 });
		expect(bad.success).toBe(false);
		expect(bad.error?.issues[0]).toMatchObject({ code: "invalid_type", path: ["currencyCode"] });
	});

	it("no sync: a conta com moeda ilegível é contada como recusada ('currencyCode: invalid_type') e as outras entram", async () => {
		const t = setup({
			item: { connector: MEU },
			accounts: [bankAccount, { ...cardAccount, currencyCode: 986 }],
			transactions: { [BANK_ACCOUNT_ID]: [] },
		});
		await t.stores.pluggyConnections.add({ id: ITEM_ID });
		const result = await t.run();
		const c = result.connections[0];
		expect(c?.status).toBe("partial");
		expect(c?.accounts).toBe(1);
		expect(
			c?.notes.some((n) =>
				/^1 conta\(s\) vieram do Pluggy fora do formato .*currencyCode: invalid_type/.test(n),
			),
		).toBe(true);
		expect(JSON.stringify(result)).not.toContain("986");
		expect(await t.stores.cards.list()).toHaveLength(0);
	});
});

describe("campo opcional fora do formato fica registrado, sem recusar a linha", () => {
	const odd = {
		...cardAccount,
		name: 4242,
		marketingName: "M".repeat(600),
		number: 5502000000004321,
		taxNumber: 12345678900,
		creditData: {
			...cardAccount.creditData,
			brand: 7,
			level: ["x"],
			creditLimit: "muito",
			balanceDueDate: 20261117,
		},
		bankData: { transferNumber: 336 },
	};

	it("lista campo e código, nunca o valor", () => {
		const parsed = accountSchema.parse(odd);
		expect(parsed.fieldProblems).toEqual(
			expect.arrayContaining([
				"name: invalid_type",
				"marketingName: truncated",
				"number: invalid_type",
				"taxNumber: invalid_type",
				"creditData.brand: invalid_type",
				"creditData.level: invalid_type",
				"creditData.creditLimit: invalid_type",
				"creditData.balanceDueDate: invalid_type",
				"bankData.transferNumber: invalid_type",
			]),
		);
		const text = JSON.stringify(parsed.fieldProblems);
		for (const value of ["4242", "MMMM", "5502", "12345678900", "muito", "336"])
			expect(text).not.toContain(value);
		expect(parsed.name).toBe("");
		expect(parsed.marketingName).toHaveLength(500);
	});

	it("o sync traz a nota e o Diagnóstico lista os campos (sem valor); a conta entra", async () => {
		const t = setup({
			item: { connector: MEU },
			accounts: [{ ...bankAccount, name: 4242, owner: 99 }],
			transactions: { [BANK_ACCOUNT_ID]: [] },
		});
		await t.stores.pluggyConnections.add({ id: ITEM_ID });
		const result = await t.run();
		const c = result.connections[0];
		expect(c?.status).toBe("ok");
		expect(c?.accounts).toBe(1);
		const note = c?.notes.find((n) => n.startsWith("Alguns campos das contas vieram fora do formato"));
		expect(note).toContain("name: invalid_type");
		expect(note).toContain("owner: invalid_type");
		expect(note).not.toContain("4242");
		const diag = await t.diagnose();
		expect(diag.accounts[0]?.fieldProblems).toEqual(["name: invalid_type", "owner: invalid_type"]);
		const text = formatPluggyDiagnostics({ generatedAt: NOW.toISOString(), connections: [diag] });
		expect(text).toContain(
			"Campos fora do formato (campo: problema): name: invalid_type | owner: invalid_type",
		);
		expect(text).not.toContain("4242");
	});
});

describe("nome ilegível: banco + tipo, refeito quando o nome vier", () => {
	it("conta e cartão sem nome ganham 'Banco · tipo' em vez de 'Conta'/'Cartão'", () => {
		const nameless = accountSchema.parse({ ...bankAccount, name: 4242, marketingName: null });
		const account = mapPluggyAccount(nameless, "MeuPluggy", [], "C6");
		expect(account).toMatchObject({ kind: "account", input: { name: "C6 Bank · conta" } });
		const nocard = accountSchema.parse({ ...cardAccount, name: null, marketingName: null });
		expect(mapPluggyAccount(nocard, "MeuPluggy", [], "C6")).toMatchObject({
			kind: "card",
			input: { name: "C6 Bank · cartão" },
		});
		expect(mapPluggyAccount(nameless, "MeuPluggy", [], null)).toMatchObject({ input: { name: "Conta" } });
	});

	it("no sync seguinte, com o nome presente, o nome gerado é trocado; o do dono não", async () => {
		const c6 = { bankData: { transferNumber: "336/0001/98765-4" } };
		const t = setup({
			item: { connector: MEU },
			accounts: [
				{ ...bankAccount, ...c6, name: 4242, marketingName: null },
				{ ...cardAccount, name: null, marketingName: null },
			],
			transactions: { [BANK_ACCOUNT_ID]: [], [CARD_ACCOUNT_ID]: [] },
		});
		await t.stores.pluggyConnections.add({ id: ITEM_ID });
		await t.run();
		expect((await t.stores.accounts.list())[0]?.name).toBe("C6 Bank · conta");
		expect((await t.stores.cards.list())[0]?.name).toBe("C6 Bank · cartão");
		t.set({
			item: { connector: MEU },
			accounts: [
				{ ...bankAccount, ...c6, name: "Conta Corrente PF" },
				{ ...cardAccount, ...c6, name: "Roxinho Platinum", marketingName: null },
			],
			transactions: { [BANK_ACCOUNT_ID]: [], [CARD_ACCOUNT_ID]: [] },
		});
		await t.run();
		expect((await t.stores.accounts.list())[0]?.name).toBe("Conta Corrente PF");
		expect((await t.stores.cards.list())[0]?.name).toContain("Roxinho Platinum");
		// Nome que o dono escolheu (não é o gerado) fica.
		const [account] = await t.stores.accounts.list();
		await t.stores.accounts.update(account?.id as string, { name: "Minha conta" });
		t.set({
			item: { connector: MEU },
			accounts: [{ ...bankAccount, ...c6, name: "Outro nome do banco" }],
			transactions: { [BANK_ACCOUNT_ID]: [] },
		});
		await t.run();
		expect((await t.stores.accounts.list())[0]?.name).toBe("Minha conta");
	});
});

describe("número e CPF longos", () => {
	it("last4 vem do número ORIGINAL, antes do corte", () => {
		const parsed = accountSchema.parse({ ...cardAccount, number: `${"0".repeat(70)}9876` });
		expect(parsed.number).toHaveLength(60);
		expect(parsed.fieldProblems).toContain("number: truncated");
		expect(parsed.numberLast4).toBe("9876");
		expect(mapPluggyAccount(parsed, "MeuPluggy", [], "C6")).toMatchObject({
			kind: "card",
			input: { last4: "9876" },
		});
	});

	it("taxNumber não é cortado aos 40: o CPF/CNPJ com espaço em volta continua inteiro", () => {
		const padded = `${" ".repeat(30)}123.456.789-00${" ".repeat(30)}`;
		const parsed = accountSchema.parse({ ...bankAccount, taxNumber: padded });
		expect(parsed.taxNumber).toBe(padded);
		expect(parsed.fieldProblems).not.toContain("taxNumber: truncated");
	});
});
