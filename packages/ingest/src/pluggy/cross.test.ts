import { createMemoryStores, type Stores } from "@orbita/db";
import { describe, expect, it } from "vitest";
import { directionFromDescription, type OwnTransferLeg, pairLegs } from "./cross.ts";
import {
	API_KEY,
	BANK_ACCOUNT_ID,
	bankAccount,
	CLIENT_ID,
	CLIENT_SECRET,
	cardAccount,
	fakePluggy,
	ITEM_ID,
	tx,
} from "./fake-pluggy.ts";
import { type SyncPluggyDeps, syncPluggy } from "./sync.ts";

/*
 * Cada banco do Meu Pluggy é uma CONEXÃO separada (conta e cartão do mesmo banco, ou de bancos diferentes). O caso do
 * dono: Inter, Mercado Pago e Santander, cada um numa conexão.
 */

const NOW = new Date("2026-11-08T12:00:00Z");
const ITEM_MP = "223e4567-e89b-42d3-a456-426614174001";
const ITEM_SANT = "323e4567-e89b-42d3-a456-426614174002";
const OWNER = "ALISSON ALVES BAPKA";

const interAccount = { ...bankAccount, name: "Conta Corrente Inter", owner: OWNER };
const mpAccount = {
	...bankAccount,
	id: "0f1d2c3b-aaaa-4bbb-8ccc-000000000011",
	itemId: ITEM_MP,
	name: "Conta Mercado Pago",
	owner: "Alisson Alves Bapka",
};
const mpCard = {
	...cardAccount,
	id: "0f1d2c3b-aaaa-4bbb-8ccc-000000000012",
	itemId: ITEM_MP,
	name: "Cartão Mercado Pago",
	marketingName: "Mercado Pago Mastercard",
	number: "5502 **** **** 7777",
	owner: "Alisson Alves Bapka",
	creditData: {
		...cardAccount.creditData,
		balanceCloseDate: "2026-11-03T00:00:00.000Z",
		balanceDueDate: "2026-11-10T00:00:00.000Z",
	},
};
const santAccount = {
	...bankAccount,
	id: "0f1d2c3b-aaaa-4bbb-8ccc-000000000021",
	itemId: ITEM_SANT,
	name: "Conta Corrente",
	owner: OWNER,
};
const santCard = {
	...cardAccount,
	id: "0f1d2c3b-aaaa-4bbb-8ccc-000000000022",
	itemId: ITEM_SANT,
	name: "FREE VISA",
	marketingName: "FREE VISA",
	number: "4000 **** **** 5512",
	owner: OWNER,
	creditData: {
		...cardAccount.creditData,
		balanceCloseDate: "2026-11-03T00:00:00.000Z",
		balanceDueDate: "2026-11-10T00:00:00.000Z",
	},
};

const bill = (id: string, dueDate: string, totalAmount: number) => ({
	id,
	dueDate,
	totalAmount,
	payments: [],
});
const day = (d: string) => `2026-11-${d}T00:00:00.000Z`;

function run(
	transactions: Record<string, Record<string, unknown>[]>,
	bills: Record<string, Record<string, unknown>[]> = {},
	stores?: Stores,
) {
	const s = stores ?? createMemoryStores({ now: () => NOW });
	const fake = fakePluggy({
		accounts: [interAccount],
		otherItems: {
			[ITEM_MP]: { accounts: [mpAccount, mpCard] },
			[ITEM_SANT]: {
				accounts: [santAccount, santCard],
				item: { connector: { id: 608, name: "Santander PF" } },
			},
		},
		transactions: {
			[BANK_ACCOUNT_ID]: [],
			[mpAccount.id]: [],
			[mpCard.id]: [],
			[santAccount.id]: [],
			[santCard.id]: [],
			...transactions,
		},
		bills: { [mpCard.id]: [], [santCard.id]: [], ...bills },
	});
	const deps: SyncPluggyDeps = {
		stores: s,
		readSecret: async (name) =>
			({ pluggy_client_id: CLIENT_ID, pluggy_client_secret: CLIENT_SECRET })[name] ?? null,
		fetch: fake.fetch,
		now: () => NOW,
	};
	return {
		stores: s,
		sync: async (options?: { connectionIds?: readonly string[] }) => syncPluggy(deps, options),
		api: API_KEY,
	};
}

async function setup(
	transactions: Record<string, Record<string, unknown>[]>,
	bills: Record<string, Record<string, unknown>[]> = {},
) {
	const t = run(transactions, bills);
	for (const id of [ITEM_ID, ITEM_MP, ITEM_SANT])
		await t.stores.pluggyConnections.add({ id, label: id.slice(0, 3) });
	return t;
}

const rows = async (stores: Stores) => {
	const all = await stores.transactions.listRecent({ limit: 100 });
	return Object.fromEntries(all.map((r) => [r.externalId as string, r]));
};

describe("sincronização com várias conexões: transferência entre contas suas", () => {
	const interOut = tx("i-out", {
		description: "Pix enviado - Fulano de Tal Qualquer",
		amount: -171.16,
		category: "Transfer - PIX",
		date: day("07"),
	});
	const mpIn = tx("m-in", {
		description: "Pix recebido FULANO DE TAL QUALQUER",
		type: "CREDIT",
		amount: 171.16,
		category: "Transfer - PIX",
		date: day("07"),
	});
	const santOut = tx("s-out", {
		description: "PIX ENVIADO   Alisson Alves Ba…",
		amount: -33.63,
		category: "Transfer - PIX",
		date: day("07"),
	});
	const mpIn2 = tx("m-in2", {
		description: "Pix recebido ALISSON ALVES BAPKA",
		type: "CREDIT",
		amount: 33.63,
		category: "Transfer - PIX",
		date: day("07"),
	});
	const rei = tx("i-rei", {
		description: "Pix enviado - Rei Dos Coins",
		amount: -39.75,
		category: "Transfer - PIX",
		date: day("06"),
	});
	const assoc = tx("s-assoc", {
		description: "PIX ENVIADO ASSOCIACAO P…",
		amount: -297.03,
		category: "Transfer - PIX",
		date: day("02"),
	});

	it("Pix a um terceiro com entrada de mesmo valor noutra conta, sem sinal de titularidade: continua gasto e receita", async () => {
		const t = await setup({ [BANK_ACCOUNT_ID]: [interOut], [mpAccount.id]: [mpIn] });
		await t.sync();
		const r = await rows(t.stores);
		expect(r["i-out"]).toMatchObject({ kind: "expense", counterpartAccountId: null, amountCents: 17_116 });
		expect(r["m-in"]).toMatchObject({ kind: "income", counterpartAccountId: null });
		// Rodar de novo não muda nada.
		const again = await t.sync();
		expect(again.connections.every((c) => (c.reclassified ?? 0) === 0)).toBe(true);
	});

	it("uma ponta com sinal (categoria 'mesma titularidade') basta: as duas viram transferência com destino", async () => {
		const signalled = { ...interOut, category: "Same person transfer" };
		const t = await setup({ [BANK_ACCOUNT_ID]: [signalled], [mpAccount.id]: [mpIn] });
		await t.sync();
		const r = await rows(t.stores);
		expect(r["i-out"]).toMatchObject({ kind: "transfer", counterpartAccountId: r["m-in"]?.accountId });
		expect(r["m-in"]).toMatchObject({ kind: "transfer", counterpartAccountId: r["i-out"]?.accountId });
		expect(r["i-out"]?.accountId).not.toBe(r["m-in"]?.accountId);
	});

	it("o nome do titular na descrição de uma ponta também vale (e o nome de um terceiro, não)", async () => {
		const named = tx("i-own", {
			description: "Pix enviado - Alisson Alves Bapka",
			amount: -80,
			category: "Transfer - PIX",
			date: day("07"),
		});
		const inMp = tx("m-own", {
			description: "Pix recebido",
			type: "CREDIT",
			amount: 80,
			category: "Transfer - PIX",
			date: day("07"),
		});
		const t = await setup({ [BANK_ACCOUNT_ID]: [named], [mpAccount.id]: [inMp] });
		await t.sync();
		const r = await rows(t.stores);
		expect(r["i-own"]).toMatchObject({ kind: "transfer", counterpartAccountId: r["m-own"]?.accountId });
		expect(r["m-own"]).toMatchObject({ kind: "transfer" });
	});

	it("transferência de sentido desconhecido nunca pareia com DESPESA de outra conta (só com entrada)", async () => {
		// Transferência própria (categoria) sem a palavra enviado/recebido na descrição: o sentido não é conhecido.
		const unknownTransfer = tx("u-1", {
			description: "Transferência Inter",
			amount: -120,
			category: "Same person transfer",
			date: day("07"),
		});
		const expenseElsewhere = tx("e-1", {
			description: "Pix enviado - Loja Qualquer",
			amount: -120,
			category: "Transfer - PIX",
			date: day("07"),
		});
		const t = await setup({ [BANK_ACCOUNT_ID]: [unknownTransfer], [mpAccount.id]: [expenseElsewhere] });
		await t.sync();
		const r = await rows(t.stores);
		expect(r["u-1"]).toMatchObject({ kind: "transfer", counterpartAccountId: null });
		expect(r["e-1"]).toMatchObject({ kind: "expense" });
	});

	it("Santander em caixa alta, com espaços e nome cortado, também é transferência própria (e pareia com o Mercado Pago)", async () => {
		const t = await setup({ [santAccount.id]: [santOut], [mpAccount.id]: [mpIn2] });
		await t.sync();
		const r = await rows(t.stores);
		expect(r["s-out"]).toMatchObject({ kind: "transfer", counterpartAccountId: r["m-in2"]?.accountId });
		expect(r["m-in2"]).toMatchObject({ kind: "transfer", counterpartAccountId: r["s-out"]?.accountId });
	});

	it("Rei dos Coins, a Associação e o Pix a terceiro continuam gasto: valor igual em outra conta não decide", async () => {
		const t = await setup({
			[BANK_ACCOUNT_ID]: [interOut, rei],
			[santAccount.id]: [assoc],
			[mpAccount.id]: [mpIn],
		});
		await t.sync();
		const r = await rows(t.stores);
		expect(r["i-rei"]).toMatchObject({ kind: "expense", amountCents: 3_975 });
		expect(r["s-assoc"]).toMatchObject({ kind: "expense", amountCents: 29_703 });
		expect(r["i-out"]).toMatchObject({ kind: "expense" });
		const spent = (await t.stores.transactions.listByBudgetMonth("2026-11"))
			.filter((x) => x.kind === "expense")
			.reduce((sum, x) => sum + x.amountCents, 0);
		expect(spent).toBe(17_116 + 3_975 + 29_703);
	});

	it("par ambíguo (duas entradas iguais) não é pareado; a linha de gasto continua gasto", async () => {
		const t = await setup({
			[BANK_ACCOUNT_ID]: [interOut],
			[mpAccount.id]: [mpIn, { ...mpIn, id: "m-in-b" }],
		});
		await t.sync();
		const r = await rows(t.stores);
		expect(r["i-out"]?.kind).toBe("expense");
	});

	it("é idempotente e não mexe no que o dono editou", async () => {
		const t = await setup({ [BANK_ACCOUNT_ID]: [interOut, rei], [mpAccount.id]: [mpIn] });
		await t.sync();
		const before = await rows(t.stores);
		const second = await t.sync();
		expect(second.connections.every((c) => (c.reclassified ?? 0) === 0)).toBe(true);
		expect(await rows(t.stores)).toEqual(before);

		// O dono marcou a saída como gasto: o passo entre contas não a transforma de novo.
		const owned = await setup({
			[BANK_ACCOUNT_ID]: [{ ...interOut, category: "Same person transfer" }],
			[mpAccount.id]: [mpIn],
		});
		await owned.sync();
		const out = (await rows(owned.stores))["i-out"];
		await owned.stores.transactions.update(out?.id ?? "", {
			kind: "expense",
			counterpartAccountId: null,
			editedByOwner: true,
		});
		await owned.sync();
		const after = await rows(owned.stores);
		// Só a marca geral (sem ter trocado a categoria) já protege o tipo, e a ponta de fora não vira transferência sozinha.
		expect(after["i-out"]).toMatchObject({
			kind: "expense",
			editedByOwner: true,
			categoryEditedByOwner: false,
		});
	});
});

describe("sincronização com várias conexões: pagamento de fatura", () => {
	const pay = tx("p-1", {
		description: "Pagamento de fatura Cartão",
		amount: -148.38,
		category: "Credit card payment",
		date: day("07"),
	});

	it("pagamento saído da conta de uma conexão liga ao cartão de OUTRA pelo total e pelo vencimento", async () => {
		const t = await setup({ [BANK_ACCOUNT_ID]: [pay] }, { [mpCard.id]: [bill("b1", day("10"), 148.38)] });
		await t.sync();
		const [card] = (await t.stores.cards.list()).filter((c) => c.last4 === "7777");
		expect((await rows(t.stores))["p-1"]).toMatchObject({
			kind: "card_payment",
			cardId: card?.id,
			note: null,
		});
		// Segunda rodada: nada muda.
		const again = await t.sync();
		expect(again.connections.every((c) => (c.reclassified ?? 0) === 0)).toBe(true);
		expect((await rows(t.stores))["p-1"]?.kind).toBe("card_payment");
	});

	it("nova tentativa só da conexão do banco: o pagamento liga ao cartão da conexão que não está na lista", async () => {
		const bills = { [mpCard.id]: [bill("b1", day("10"), 148.38)] };
		const first = await setup({}, bills);
		await first.sync();
		// Agora o pagamento aparece na conta Inter e só essa conexão é sincronizada (a do cartão fica de fora).
		const retry = run({ [BANK_ACCOUNT_ID]: [pay] }, bills, first.stores);
		const result = await retry.sync({ connectionIds: [ITEM_ID] });
		expect(result.connections.map((c) => c.id)).toEqual([ITEM_ID]);
		const [card] = (await first.stores.cards.list()).filter((c) => c.last4 === "7777");
		expect((await rows(first.stores))["p-1"]).toMatchObject({
			kind: "card_payment",
			cardId: card?.id,
			note: null,
		});
	});

	it("o valor que faltava pagar também vale, e o vencimento longe demais não", async () => {
		const partial = {
			id: "b1",
			dueDate: day("10"),
			totalAmount: 500,
			payments: [{ paymentDate: day("05"), amount: 351.62 }],
		};
		const near = await setup({ [BANK_ACCOUNT_ID]: [pay] }, { [mpCard.id]: [partial] });
		await near.sync();
		expect((await rows(near.stores))["p-1"]?.kind).toBe("card_payment");

		const far = await setup(
			{ [BANK_ACCOUNT_ID]: [{ ...pay, date: day("01") }] },
			{ [mpCard.id]: [bill("b1", day("10"), 148.38)] },
		);
		await far.sync();
		expect((await rows(far.stores))["p-1"]).toMatchObject({
			kind: "expense",
			note: expect.stringContaining("não conectado"),
		});
	});

	it("dois cartões com o mesmo total e sem emissor na descrição: fica para revisão; com o emissor, desempata", async () => {
		const both = {
			[mpCard.id]: [bill("b1", day("10"), 148.38)],
			[santCard.id]: [bill("b2", day("10"), 148.38)],
		};
		const amb = await setup({ [BANK_ACCOUNT_ID]: [pay] }, both);
		await amb.sync();
		expect((await rows(amb.stores))["p-1"]).toMatchObject({ kind: "expense", status: "pending" });

		const named = await setup(
			{ [BANK_ACCOUNT_ID]: [{ ...pay, description: "Pagamento de fatura Cartão Mercado Pago" }] },
			both,
		);
		await named.sync();
		expect((await rows(named.stores))["p-1"]?.kind).toBe("card_payment");
	});

	it("linha que já estava em 'Fatura de cartão' é reavaliada na rodada seguinte", async () => {
		// 1ª rodada: a fatura do cartão ainda não existia.
		const t = await setup({ [BANK_ACCOUNT_ID]: [pay] });
		await t.sync();
		expect((await rows(t.stores))["p-1"]).toMatchObject({ kind: "expense" });
		// 2ª: o cartão (outra conexão) agora tem a fatura.
		const fake = fakePluggy({
			accounts: [interAccount],
			otherItems: {
				[ITEM_MP]: { accounts: [mpAccount, mpCard] },
				[ITEM_SANT]: { accounts: [santAccount, santCard] },
			},
			transactions: {
				[BANK_ACCOUNT_ID]: [pay],
				[mpAccount.id]: [],
				[mpCard.id]: [],
				[santAccount.id]: [],
				[santCard.id]: [],
			},
			bills: { [mpCard.id]: [bill("b1", day("10"), 148.38)], [santCard.id]: [] },
		});
		await syncPluggy({
			stores: t.stores,
			readSecret: async (name) =>
				({ pluggy_client_id: CLIENT_ID, pluggy_client_secret: CLIENT_SECRET })[name] ?? null,
			fetch: fake.fetch,
			now: () => NOW,
		});
		expect((await rows(t.stores))["p-1"]?.kind).toBe("card_payment");
	});
});

describe("sincronização com várias conexões: pagamento parcial ou adiantado (payments[])", () => {
	// Fatura do Mercado Pago de R$ 800,00 vencendo dia 10; R$ 200,00 pagos dia 02 (8 dias antes) pela conta do Inter.
	const partialBill = {
		id: "b1",
		dueDate: day("10"),
		totalAmount: 800,
		payments: [{ paymentDate: day("02"), amount: 200 }],
	};
	const pix = tx("p-pix", { description: "Pix enviado", amount: -200, date: day("02") });

	it("débito de uma conta de OUTRA conexão que bate com payments[] vira card_payment do cartão certo", async () => {
		const t = await setup({ [BANK_ACCOUNT_ID]: [pix] }, { [mpCard.id]: [partialBill] });
		await t.sync();
		const [card] = (await t.stores.cards.list()).filter((c) => c.last4 === "7777");
		expect((await rows(t.stores))["p-pix"]).toMatchObject({
			kind: "card_payment",
			cardId: card?.id,
			note: null,
		});
		// Idempotente.
		const again = await t.sync();
		expect(again.connections.every((c) => (c.reclassified ?? 0) === 0)).toBe(true);
		expect((await rows(t.stores))["p-pix"]?.kind).toBe("card_payment");
	});

	it("pagamento com texto de fatura feito mais de 5 dias antes do vencimento também liga pelo payments[]", async () => {
		const text = tx("p-1", {
			description: "Pagamento de fatura Cartão",
			amount: -200,
			category: "Credit card payment",
			date: day("02"),
		});
		const t = await setup({ [BANK_ACCOUNT_ID]: [text] }, { [mpCard.id]: [partialBill] });
		await t.sync();
		const [card] = (await t.stores.cards.list()).filter((c) => c.last4 === "7777");
		expect((await rows(t.stores))["p-1"]).toMatchObject({ kind: "card_payment", cardId: card?.id });
	});

	it("valor diferente ou mais de 3 dias de distância continuam sendo gasto", async () => {
		const other = tx("p-other", { description: "Pix enviado", amount: -201, date: day("02") });
		const late = tx("p-late", { description: "Pix enviado", amount: -200, date: day("07") });
		const t = await setup({ [BANK_ACCOUNT_ID]: [other, late] }, { [mpCard.id]: [partialBill] });
		await t.sync();
		const r = await rows(t.stores);
		expect(r["p-other"]?.kind).toBe("expense");
		expect(r["p-late"]?.kind).toBe("expense");
	});

	it("um pagamento casa com UM débito: o segundo Pix igual continua gasto", async () => {
		const twin = tx("p-twin", { description: "Pix enviado", amount: -200, date: day("02") });
		const t = await setup({ [BANK_ACCOUNT_ID]: [pix, twin] }, { [mpCard.id]: [partialBill] });
		await t.sync();
		const kinds = Object.values(await rows(t.stores)).map((r) => r.kind);
		expect(kinds.filter((k) => k === "card_payment")).toHaveLength(1);
		expect(kinds.filter((k) => k === "expense")).toHaveLength(1);
	});

	it("o que o dono editou não é religado ao cartão", async () => {
		const t = await setup({ [BANK_ACCOUNT_ID]: [pix] }, {});
		await t.sync();
		const mine = (await rows(t.stores))["p-pix"];
		expect(mine?.kind).toBe("expense");
		await t.stores.transactions.update(mine?.id ?? "", { editedByOwner: true });
		const fake = fakePluggy({
			accounts: [interAccount],
			otherItems: {
				[ITEM_MP]: { accounts: [mpAccount, mpCard] },
				[ITEM_SANT]: { accounts: [santAccount, santCard] },
			},
			transactions: {
				[BANK_ACCOUNT_ID]: [pix],
				[mpAccount.id]: [],
				[mpCard.id]: [],
				[santAccount.id]: [],
				[santCard.id]: [],
			},
			bills: { [mpCard.id]: [partialBill], [santCard.id]: [] },
		});
		await syncPluggy({
			stores: t.stores,
			readSecret: async (name) =>
				({ pluggy_client_id: CLIENT_ID, pluggy_client_secret: CLIENT_SECRET })[name] ?? null,
			fetch: fake.fetch,
			now: () => NOW,
		});
		expect((await rows(t.stores))["p-pix"]).toMatchObject({ kind: "expense", cardId: null });
	});

	it("transferência própria já identificada (com sinal de titularidade) não vira pagamento de fatura", async () => {
		const own = tx("p-own", {
			description: "Pix para mim",
			amount: -200,
			category: "Same person transfer",
			date: day("02"),
		});
		const t = await setup({ [BANK_ACCOUNT_ID]: [own] }, { [mpCard.id]: [partialBill] });
		await t.sync();
		expect((await rows(t.stores))["p-own"]?.kind).toBe("transfer");
	});
});

describe("sincronização com várias conexões: pagamento que o dono já revisou", () => {
	it("pendente que o dono confirmou como gasto (marca geral) não é religado a cartão depois", async () => {
		const pay = tx("p-1", {
			description: "Pagamento de fatura Cartão",
			amount: -148.38,
			category: "Credit card payment",
			date: day("07"),
		});
		const both = {
			[mpCard.id]: [bill("b1", day("10"), 148.38)],
			[santCard.id]: [bill("b2", day("10"), 148.38)],
		};
		const t = await setup({ [BANK_ACCOUNT_ID]: [pay] }, both);
		await t.sync();
		const pending = (await rows(t.stores))["p-1"];
		expect(pending).toMatchObject({ kind: "expense", status: "pending" });
		// O dono confirmou ("é gasto mesmo"): a confirmação liga a marca geral.
		await t.stores.transactions.update(pending?.id ?? "", { status: "confirmed", editedByOwner: true });
		// Agora só um cartão tem a fatura: sem a marca, o pagamento viraria card_payment desse cartão.
		const fake = fakePluggy({
			accounts: [interAccount],
			otherItems: {
				[ITEM_MP]: { accounts: [mpAccount, mpCard] },
				[ITEM_SANT]: { accounts: [santAccount, santCard] },
			},
			transactions: {
				[BANK_ACCOUNT_ID]: [pay],
				[mpAccount.id]: [],
				[mpCard.id]: [],
				[santAccount.id]: [],
				[santCard.id]: [],
			},
			bills: { [mpCard.id]: [bill("b1", day("10"), 148.38)], [santCard.id]: [] },
		});
		await syncPluggy({
			stores: t.stores,
			readSecret: async (name) =>
				({ pluggy_client_id: CLIENT_ID, pluggy_client_secret: CLIENT_SECRET })[name] ?? null,
			fetch: fake.fetch,
			now: () => NOW,
		});
		expect((await rows(t.stores))["p-1"]).toMatchObject({ kind: "expense", status: "confirmed" });
	});
});

describe("sincronização: compra no cartão pela data da compra", () => {
	const kiwify = tx("c-kiwify", { description: "Kiwify", amount: 134.14, date: day("06") });
	const amazon = tx("c-amazon", {
		description: "Amazon",
		amount: 10,
		date: "2026-11-08T00:00:00.000Z",
		creditCardMetadata: { purchaseDate: "2026-09-30T00:00:00.000Z" },
	});
	const parcela = tx("c-par", {
		description: "Geladeira",
		amount: 250,
		date: "2026-10-20T00:00:00.000Z",
		creditCardMetadata: {
			installmentNumber: 3,
			totalInstallments: 6,
			purchaseDate: "2026-09-20T00:00:00.000Z",
		},
	});

	it("compra de novembro soma ao Gasto de novembro; parcela no mês compra + n − 1; data da fatura não vira a data da compra", async () => {
		const t = await setup({ [santCard.id]: [kiwify, amazon, parcela] });
		await t.sync();
		const r = await rows(t.stores);
		expect(r["c-kiwify"]).toMatchObject({ kind: "expense", date: "2026-11-06", budgetMonth: "2026-11" });
		expect(r["c-amazon"]).toMatchObject({ date: "2026-09-30", budgetMonth: "2026-09" });
		expect(r["c-par"]).toMatchObject({ date: "2026-09-20", budgetMonth: "2026-11" });
		const november = (await t.stores.transactions.listByBudgetMonth("2026-11")).filter(
			(x) => x.cardId !== null,
		);
		expect(november.map((x) => x.externalId).sort()).toEqual(["c-kiwify", "c-par"]);
	});

	it("recalcula linha antiga com data/mês tortos (fatura), é idempotente e respeita o que o dono editou", async () => {
		const t = await setup({ [santCard.id]: [kiwify, amazon, parcela] });
		await t.sync();
		const r = await rows(t.stores);
		// Estado deixado pelos regimes antigos: data na fatura, mês da fatura.
		await t.stores.transactions.update(r["c-amazon"]?.id ?? "", {
			date: "2026-11-30",
			budgetMonth: "2026-11",
		});
		await t.stores.transactions.update(r["c-kiwify"]?.id ?? "", { budgetMonth: "2026-12" });
		await t.stores.transactions.update(r["c-par"]?.id ?? "", { budgetMonth: "2026-12" });
		const edited = r["c-par"];
		await t.stores.transactions.update(edited?.id ?? "", { categoryEditedByOwner: true });

		await t.sync();
		const fixed = await rows(t.stores);
		expect(fixed["c-amazon"]).toMatchObject({ date: "2026-09-30", budgetMonth: "2026-09", kind: "expense" });
		expect(fixed["c-kiwify"]).toMatchObject({ budgetMonth: "2026-11" });
		expect(fixed["c-par"]).toMatchObject({ budgetMonth: "2026-12" }); // editada pelo dono: fica

		const snapshot = await rows(t.stores);
		const again = await t.sync();
		expect(again.connections.every((c) => (c.reclassified ?? 0) === 0)).toBe(true);
		expect(await rows(t.stores)).toEqual(snapshot);
	});
});

describe("pairLegs: sinal de titularidade e sentido", () => {
	const leg = (
		id: string,
		accountId: string,
		direction: OwnTransferLeg["direction"],
		ownerSignal: boolean,
	) => ({
		id,
		accountId,
		direction,
		amountCents: 5_000,
		date: "2026-11-07",
		ownerSignal,
	});

	it("sem sinal em nenhuma ponta não pareia; com sinal em uma, pareia", () => {
		expect([...pairLegs([leg("o", "A", "out", false), leg("i", "B", "in", false)])]).toEqual([]);
		expect(pairLegs([leg("o", "A", "out", true), leg("i", "B", "in", false)]).get("i")).toBe("o");
		expect(pairLegs([leg("o", "A", "out", false), leg("i", "B", "in", true)]).get("o")).toBe("i");
	});

	it("sentido desconhecido nunca pareia com saída; pareia com entrada ou com outro desconhecido", () => {
		expect([...pairLegs([leg("u", "A", "unknown", true), leg("o", "B", "out", false)])]).toEqual([]);
		expect(pairLegs([leg("u", "A", "unknown", true), leg("i", "B", "in", false)]).get("u")).toBe("i");
		expect(pairLegs([leg("u", "A", "unknown", true), leg("v", "B", "unknown", true)]).get("u")).toBe("v");
		// Duas saídas ou duas entradas nunca são os dois lados.
		expect([...pairLegs([leg("o1", "A", "out", true), leg("o2", "B", "out", true)])]).toEqual([]);
	});

	it("empate (duas candidatas) não pareia, mesmo com sinal", () => {
		const legs = [
			leg("o", "A", "out", true),
			leg("i1", "B", "in", false),
			{ ...leg("i2", "C", "in", false) },
		];
		expect([...pairLegs(legs)]).toEqual([]);
	});

	it("o sentido de uma transferência já gravada vem da descrição", () => {
		expect(directionFromDescription("PIX ENVIADO Alisson")).toBe("out");
		expect(directionFromDescription("Pix recebido FULANO")).toBe("in");
		expect(directionFromDescription("Transferência Inter")).toBe("unknown");
		expect(directionFromDescription("Pix enviado e recebido")).toBe("unknown");
	});
});
