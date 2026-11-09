import { createMemoryStores, type Stores } from "@orbita/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
	BANK_ACCOUNT_ID,
	CARD_ACCOUNT_ID,
	CLIENT_ID,
	CLIENT_SECRET,
	type FakePluggyOptions,
	fakePluggy,
	ITEM_ID,
	tx,
} from "./fake-pluggy.ts";
import { REMOVED_BY_BANK_NOTE } from "./recreated.ts";
import { type SyncPluggyDeps, syncPluggy } from "./sync.ts";

/*
 * Cenários da doc da Pluggy para a fatura aberta e para o que o banco apaga/recria:
 * - docs.pluggy.ai/docs/credit-card-installments ("The lifecycle of a card transaction": PENDING sem billId até a
 *   fatura vencer; "Warning: deleted and recreated transactions": some 1 a 3 dias e volta com id novo);
 * - docs.pluggy.ai/docs/transactions ("Transaction Id can change": mesmo id no PENDING → POSTED, id novo só quando data,
 *   descrição ou valor mudam demais; âncoras providerId/providerCode; PENDING na conta = agendado).
 */

const DAY = 86_400_000;
const T0 = new Date("2026-11-12T09:00:00Z"); // 06:00 em São Paulo
const at = (days: number) => new Date(T0.getTime() + days * DAY);
const SECRETS: Record<string, string | null> = {
	pluggy_client_id: CLIENT_ID,
	pluggy_client_secret: CLIENT_SECRET,
};
const bill = (id: string, dueDate: string, totalAmount: number) => ({
	id,
	dueDate,
	totalAmount,
	payments: [],
});

/** Compra no cartão ainda na fatura aberta: PENDING, sem billId. */
const pendingBuy = (id: string, extra: Record<string, unknown> = {}) =>
	tx(id, {
		description: "Livraria Cultura",
		amount: 89.9,
		date: "2026-11-09T00:00:00.000Z",
		status: "PENDING",
		providerId: "prov-livraria",
		creditCardMetadata: { billForecastDate: "2026-11" },
		...extra,
	});
/** A mesma compra depois que a fatura venceu: POSTED, com billId. */
const postedBuy = (id: string, extra: Record<string, unknown> = {}) =>
	pendingBuy(id, { status: "POSTED", creditCardMetadata: { billId: "bill-nov" }, ...extra });
/** Uma compra qualquer que sempre vem, para a resposta nunca ficar vazia. */
const anchor = () => tx("c-anchor", { description: "Padaria", amount: 12, date: "2026-11-08T00:00:00.000Z" });

function setup(cardTxs: Record<string, unknown>[], options: FakePluggyOptions = {}) {
	const stores = createMemoryStores({ now: () => clock });
	let clock = T0;
	const lists: Record<string, Record<string, unknown>[]> = {
		[BANK_ACCOUNT_ID]: [],
		[CARD_ACCOUNT_ID]: cardTxs,
	};
	const fake = fakePluggy({
		transactions: lists,
		bills: { [CARD_ACCOUNT_ID]: [bill("bill-nov", "2026-11-17T00:00:00.000Z", 89.9)] },
		...options,
	});
	const deps = (): SyncPluggyDeps => ({
		stores,
		readSecret: async (name) => SECRETS[name] ?? null,
		fetch: fake.fetch,
		now: () => clock,
	});
	return {
		stores,
		lists,
		run: () => syncPluggy(deps()),
		setNow: (d: Date) => {
			clock = d;
		},
	};
}

const live = (stores: Stores) => stores.transactions.listRecent({ limit: 200 });
const cardResult = (r: Awaited<ReturnType<typeof syncPluggy>>) => r.connections[0];

describe("fatura aberta do cartão (PENDING)", () => {
	let t: ReturnType<typeof setup>;
	beforeEach(async () => {
		t = setup([anchor(), pendingBuy("p-1")]);
		await t.stores.pluggyConnections.add({ id: ITEM_ID, label: "Nubank" });
	});

	it("a compra PENDING entra no gasto, pela data da compra, marcada como pendente no banco", async () => {
		const run = await t.run();
		expect(cardResult(run)?.pendingStored).toBe(1);
		const [row] = (await live(t.stores)).filter((r) => r.externalId === "p-1");
		expect(row).toMatchObject({
			kind: "expense",
			amountCents: 8990,
			date: "2026-11-09",
			budgetMonth: "2026-11",
			invoiceMonth: "2026-11",
			bankPending: true,
			providerId: "prov-livraria",
			// Não é o "Para revisar" do Órbita.
			status: "confirmed",
			source: "pluggy",
		});
		// Conta no gasto do mês: mesma lista que o resumo usa (listByBudgetMonth).
		const month = await t.stores.transactions.listByBudgetMonth("2026-11");
		expect(month.map((r) => r.externalId)).toContain("p-1");
		// E aparece na fatura do cartão.
		const [card] = await t.stores.cards.list();
		const invoice = await t.stores.transactions.listByInvoice(card?.id as string, "2026-11");
		expect(invoice.map((r) => r.externalId)).toContain("p-1");
	});

	it("rodar de novo não duplica nem mexe em nada", async () => {
		await t.run();
		const before = await live(t.stores);
		t.setNow(at(1));
		const again = await t.run();
		expect(cardResult(again)?.created).toBe(0);
		expect(await live(t.stores)).toHaveLength(before.length);
	});

	it("vira POSTED com o MESMO id: atualiza no lugar (sem duplicar), ganha a fatura do billId", async () => {
		await t.run();
		const original = (await live(t.stores)).find((r) => r.externalId === "p-1");
		t.setNow(at(6)); // a fatura venceu
		t.lists[CARD_ACCOUNT_ID] = [anchor(), postedBuy("p-1")];
		const run = await t.run();
		expect(cardResult(run)?.settled).toBe(1);
		expect(cardResult(run)?.created).toBe(0);
		const rows = (await live(t.stores)).filter((r) => r.description === "Livraria Cultura");
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			id: original?.id,
			externalId: "p-1",
			bankPending: false,
			invoiceMonth: "2026-11",
		});
	});

	it("o valor que o banco corrige ao efetivar vale; o que o dono editou, não", async () => {
		await t.run();
		const row = (await live(t.stores)).find((r) => r.externalId === "p-1");
		t.setNow(at(6));
		t.lists[CARD_ACCOUNT_ID] = [anchor(), postedBuy("p-1", { amount: 91.2 })];
		await t.run();
		expect((await t.stores.transactions.get(row?.id as string))?.amountCents).toBe(9120);

		// Outra pendente que o dono corrigiu à mão: o valor dele fica.
		const second = setup([anchor(), pendingBuy("p-2", { providerId: "prov-2", description: "Cinema" })]);
		await second.stores.pluggyConnections.add({ id: ITEM_ID, label: "Nubank" });
		await second.run();
		const mine = (await live(second.stores)).find((r) => r.externalId === "p-2");
		await second.stores.transactions.update(mine?.id as string, { amountCents: 5000, editedByOwner: true });
		second.setNow(at(6));
		second.lists[CARD_ACCOUNT_ID] = [
			anchor(),
			postedBuy("p-2", { providerId: "prov-2", description: "Cinema", amount: 99 }),
		];
		await second.run();
		expect(await second.stores.transactions.get(mine?.id as string)).toMatchObject({
			amountCents: 5000,
			bankPending: false,
			editedByOwner: true,
		});
	});

	it("vira POSTED com id NOVO: reconcilia pelo providerId e não duplica", async () => {
		await t.run();
		const original = (await live(t.stores)).find((r) => r.externalId === "p-1");
		t.setNow(at(6));
		// A Pluggy apagou p-1 e recriou: id novo, data e descrição mudaram demais, mesmo providerId.
		t.lists[CARD_ACCOUNT_ID] = [
			anchor(),
			postedBuy("p-NEW", { description: "LIVRARIA CULTURA SP", date: "2026-11-10T00:00:00.000Z" }),
		];
		const run = await t.run();
		expect(cardResult(run)?.recreated).toBe(1);
		const rows = (await live(t.stores)).filter((r) => r.providerId === "prov-livraria");
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ id: original?.id, externalId: "p-NEW", bankPending: false });
		// O id antigo está livre e nada ficou "removido pelo banco" depois.
		expect(await t.stores.transactions.findByExternal("pluggy", "p-1")).toBeNull();
	});

	it("vira POSTED com id novo SEM providerId: reconcilia por valor, tipo, data ±3 dias e descrição", async () => {
		t = setup([anchor(), pendingBuy("p-1", { providerId: null })]);
		await t.stores.pluggyConnections.add({ id: ITEM_ID, label: "Nubank" });
		await t.run();
		const original = (await live(t.stores)).find((r) => r.externalId === "p-1");
		t.setNow(at(6));
		t.lists[CARD_ACCOUNT_ID] = [
			anchor(),
			postedBuy("p-NEW", { providerId: null, date: "2026-11-11T00:00:00.000Z" }),
		];
		const run = await t.run();
		expect(cardResult(run)?.recreated).toBe(1);
		const rows = (await live(t.stores)).filter((r) => r.description === "Livraria Cultura");
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ id: original?.id, externalId: "p-NEW", bankPending: false });
	});

	it("providerCode precisa vir com o mesmo valor: outro valor não é o mesmo lançamento", async () => {
		t = setup([anchor(), pendingBuy("p-1", { providerId: null, providerCode: "nsu-1" })]);
		await t.stores.pluggyConnections.add({ id: ITEM_ID, label: "Nubank" });
		await t.run();
		t.setNow(at(1));
		t.lists[CARD_ACCOUNT_ID] = [
			anchor(),
			postedBuy("p-NEW", { providerId: null, providerCode: "nsu-1", amount: 10, description: "Outra coisa" }),
		];
		const run = await t.run();
		expect(cardResult(run)?.recreated ?? 0).toBe(0);
		expect((await live(t.stores)).filter((r) => r.providerCode === "nsu-1")).toHaveLength(2);
	});

	it("ambíguo (dois sumidos iguais, um novo): cria o novo e marca possível duplicata para revisar", async () => {
		const twin = (id: string) => pendingBuy(id, { providerId: null, description: "Café Central", amount: 9 });
		t = setup([anchor(), twin("p-a"), twin("p-b")]);
		await t.stores.pluggyConnections.add({ id: ITEM_ID, label: "Nubank" });
		await t.run();
		t.setNow(at(1));
		t.lists[CARD_ACCOUNT_ID] = [
			anchor(),
			postedBuy("p-NEW", { providerId: null, description: "Café Central", amount: 9 }),
		];
		const run = await t.run();
		expect(cardResult(run)?.possibleDuplicates).toBe(1);
		const created = (await live(t.stores)).find((r) => r.externalId === "p-NEW");
		expect(created).toMatchObject({ status: "pending" });
		expect(created?.note).toContain("Possível duplicata");
	});

	it("dois lançamentos novos iguais para dois sumidos iguais casam um a um", async () => {
		const twin = (id: string, extra = {}) =>
			pendingBuy(id, { providerId: null, description: "Café Central", amount: 9, ...extra });
		t = setup([anchor(), twin("p-a"), twin("p-b")]);
		await t.stores.pluggyConnections.add({ id: ITEM_ID, label: "Nubank" });
		await t.run();
		const before = (await live(t.stores))
			.filter((r) => r.description === "Café Central")
			.map((r) => r.id)
			.sort();
		t.setNow(at(1));
		t.lists[CARD_ACCOUNT_ID] = [
			anchor(),
			twin("n-a", { status: "POSTED" }),
			twin("n-b", { status: "POSTED" }),
		];
		const run = await t.run();
		// Mesmo dia e mesma descrição: quem casa é o religamento exato (`rekeyed`); com data ou texto diferentes, `recreated`.
		const result = cardResult(run);
		expect((result?.recreated ?? 0) + (result?.rekeyed ?? 0)).toBe(2);
		const after = (await live(t.stores)).filter((r) => r.description === "Café Central");
		expect(after.map((r) => r.id).sort()).toEqual(before);
		expect(after.map((r) => r.externalId).sort()).toEqual(["n-a", "n-b"]);
	});

	it("some por 1 a 3 dias e volta com id novo: continua o mesmo lançamento, sem duplicar", async () => {
		await t.run();
		const original = (await live(t.stores)).find((r) => r.externalId === "p-1");
		// Dia 1 e 2: o banco deixa de devolver. Nada é apagado ainda.
		for (const day of [1, 2]) {
			t.setNow(at(day));
			t.lists[CARD_ACCOUNT_ID] = [anchor()];
			const run = await t.run();
			expect(cardResult(run)?.removedByBank ?? 0).toBe(0);
			expect(await t.stores.transactions.get(original?.id as string)).not.toBeNull();
		}
		// Dia 3: volta com id novo.
		t.setNow(at(3));
		t.lists[CARD_ACCOUNT_ID] = [anchor(), pendingBuy("p-BACK")];
		await t.run();
		const rows = (await live(t.stores)).filter((r) => r.description === "Livraria Cultura");
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ id: original?.id, externalId: "p-BACK", bankPending: true });
	});

	it("some de vez: depois do prazo é removida ('removido pelo banco') e deixa de contar", async () => {
		await t.run();
		const original = (await live(t.stores)).find((r) => r.externalId === "p-1");
		t.lists[CARD_ACCOUNT_ID] = [anchor()];
		t.setNow(at(3));
		expect(cardResult(await t.run())?.removedByBank ?? 0).toBe(0);
		t.setNow(at(7));
		const run = await t.run();
		expect(cardResult(run)?.removedByBank).toBe(1);
		expect(await t.stores.transactions.get(original?.id as string)).toBeNull();
		expect((await t.stores.transactions.listByBudgetMonth("2026-11")).map((r) => r.externalId)).not.toContain(
			"p-1",
		);
		// Rodar de novo não faz nada de novo.
		t.setNow(at(8));
		expect(cardResult(await t.run())?.removedByBank ?? 0).toBe(0);
	});

	it("pode sumir e voltar com o mesmo id mesmo depois de removido (idempotente)", async () => {
		await t.run();
		const original = (await live(t.stores)).find((r) => r.externalId === "p-1");
		t.lists[CARD_ACCOUNT_ID] = [anchor()];
		t.setNow(at(8));
		await t.run();
		expect(await t.stores.transactions.get(original?.id as string)).toBeNull();
		t.setNow(at(9));
		t.lists[CARD_ACCOUNT_ID] = [anchor(), pendingBuy("p-1")];
		const run = await t.run();
		expect(cardResult(run)?.restored).toBe(1);
		expect(cardResult(run)?.created).toBe(0);
		expect(await t.stores.transactions.get(original?.id as string)).toMatchObject({ externalId: "p-1" });
		expect((await live(t.stores)).filter((r) => r.externalId === "p-1")).toHaveLength(1);
	});

	it("o que o DONO apagou não volta quando o banco o traz de novo", async () => {
		await t.run();
		const row = (await live(t.stores)).find((r) => r.externalId === "p-1");
		await t.stores.transactions.softDelete(row?.id as string);
		t.setNow(at(1));
		await t.run();
		expect((await live(t.stores)).filter((r) => r.externalId === "p-1")).toHaveLength(0);
	});

	it("o que o dono editou não é apagado quando some: vai para revisão, uma vez só", async () => {
		await t.run();
		const row = (await live(t.stores)).find((r) => r.externalId === "p-1");
		await t.stores.transactions.update(row?.id as string, {
			description: "Livro do João",
			editedByOwner: true,
		});
		t.lists[CARD_ACCOUNT_ID] = [anchor()];
		t.setNow(at(1));
		await t.run();
		t.setNow(at(8));
		const run = await t.run();
		expect(cardResult(run)?.flaggedMissing).toBe(1);
		expect(cardResult(run)?.removedByBank ?? 0).toBe(0);
		expect(await t.stores.transactions.get(row?.id as string)).toMatchObject({
			description: "Livro do João",
			status: "pending",
			note: REMOVED_BY_BANK_NOTE,
			editedByOwner: true,
		});
		t.setNow(at(15));
		expect(cardResult(await t.run())?.flaggedMissing ?? 0).toBe(0);
		// Se o banco trouxer de volta, a marca de "sumiu" sai.
		t.setNow(at(16));
		t.lists[CARD_ACCOUNT_ID] = [anchor(), pendingBuy("p-1")];
		await t.run();
		expect(await t.stores.transactions.get(row?.id as string)).toMatchObject({ removedByBankAt: null });
	});

	it("lançamento de antes desta versão (nunca visto) começa a contar: não é apagado de cara", async () => {
		await t.run();
		const [card] = await t.stores.cards.list();
		const legacy = await t.stores.transactions.upsertByExternal("pluggy", "legacy-1", {
			kind: "expense",
			amountCents: 4200,
			date: "2026-11-05",
			description: "Compra antiga",
			cardId: card?.id as string,
			invoiceMonth: "2026-11",
		});
		expect(legacy.transaction?.lastSeenAt).toBeNull();
		t.setNow(at(1));
		const first = await t.run();
		expect(cardResult(first)?.removedByBank ?? 0).toBe(0);
		expect((await t.stores.transactions.get(legacy.transaction?.id as string))?.lastSeenAt).not.toBeNull();
		t.setNow(at(9));
		expect(cardResult(await t.run())?.removedByBank).toBe(1);
		expect(await t.stores.transactions.get(legacy.transaction?.id as string)).toBeNull();
	});

	it("resposta vazia ou com sumiço em massa não apaga nada (instabilidade do banco)", async () => {
		const many = Array.from({ length: 8 }, (_, i) =>
			tx(`m-${i}`, { description: `Loja ${i}`, amount: 10 + i, date: "2026-11-08T00:00:00.000Z" }),
		);
		t = setup([anchor(), ...many]);
		await t.stores.pluggyConnections.add({ id: ITEM_ID, label: "Nubank" });
		await t.run();
		t.setNow(at(10));
		t.lists[CARD_ACCOUNT_ID] = [];
		expect(cardResult(await t.run())?.removedByBank ?? 0).toBe(0);
		t.lists[CARD_ACCOUNT_ID] = [anchor()];
		const run = await t.run();
		expect(cardResult(run)?.removedByBank ?? 0).toBe(0);
		expect(run.connections[0]?.notes.join(" ")).toContain("não apaguei nada");
		expect((await live(t.stores)).length).toBeGreaterThanOrEqual(9);
	});

	it("item que não está atualizado não prova que o banco apagou", async () => {
		let status = "UPDATED";
		t = setup([anchor(), pendingBuy("p-1")], { item: () => ({ status }) });
		await t.stores.pluggyConnections.add({ id: ITEM_ID, label: "Nubank" });
		await t.run();
		t.lists[CARD_ACCOUNT_ID] = [anchor()];
		status = "UPDATING";
		t.setNow(at(10));
		expect(cardResult(await t.run())?.removedByBank ?? 0).toBe(0);
		expect((await live(t.stores)).some((r) => r.externalId === "p-1")).toBe(true);
	});
});

describe("PENDING na conta e conector", () => {
	it("agendado na conta (PENDING, data futura) não conta como gasto ainda", async () => {
		const t = setup([anchor()]);
		t.lists[BANK_ACCOUNT_ID] = [
			tx("b-sched", {
				description: "Aluguel agendado",
				amount: -2500,
				date: "2026-11-20T00:00:00.000Z",
				status: "PENDING",
			}),
			tx("b-proc", { description: "Compra em processamento", amount: -30, status: "PENDING" }),
		];
		await t.stores.pluggyConnections.add({ id: ITEM_ID, label: "Nubank" });
		const run = await t.run();
		// O agendado tem data futura e a janela termina hoje: nem chega. O em processamento chega e é ignorado.
		expect(cardResult(run)?.skipped.pending).toBe(1);
		expect((await live(t.stores)).filter((r) => r.accountId !== null)).toHaveLength(0);
	});

	it("guarda connector.isOpenFinance na conexão", async () => {
		const t = setup([anchor()], {
			item: { connector: { id: 612, name: "Nubank", isSandbox: false, isOpenFinance: true } },
		});
		await t.stores.pluggyConnections.add({ id: ITEM_ID, label: "Nubank" });
		expect(await t.stores.pluggyConnections.get(ITEM_ID)).toMatchObject({ isOpenFinance: null });
		await t.run();
		expect(await t.stores.pluggyConnections.get(ITEM_ID)).toMatchObject({ isOpenFinance: true });
	});
});
