import { createMemoryStores, type Stores } from "@orbita/db";
import { NOTIFICATION_BANK_PACKAGES, type NotificationItem } from "@orbita/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
	BANK_ACCOUNT_ID,
	CARD_ACCOUNT_ID,
	CLIENT_ID,
	CLIENT_SECRET,
	fakePluggy,
	ITEM_ID,
	tx,
} from "../pluggy/fake-pluggy.ts";
import { type SyncPluggyDeps, syncPluggy } from "../pluggy/sync.ts";
import {
	chooseInboxCard,
	inboxCardChoices,
	ingestNotification,
	NOTIFICATION_SOURCE,
	retryNotificationInbox,
} from "./ingest.ts";

/*
 * Compra online usa o final do cartão virtual (diferente do físico que o Open Finance traz), "Compra cancelada" do
 * Santander e propaganda que chega com "R$". Textos e finais inventados.
 */

const NOW = new Date("2026-11-16T20:00:00Z");
/** 15/11/2026 21:58 em São Paulo. */
const BOUGHT = Date.parse("2026-11-16T00:58:00Z");
/** 16/11/2026 14:08 em São Paulo. */
const CANCELLED = Date.parse("2026-11-16T17:08:00Z");
const NU = NOTIFICATION_BANK_PACKAGES.nubank[0] as string;
const SANTANDER = NOTIFICATION_BANK_PACKAGES.santander[0] as string;
const INTER = NOTIFICATION_BANK_PACKAGES.inter[0] as string;
const SANTANDER_ISPB = "90400888";
const NUBANK_ISPB = "18236120";

const note = (pkg: string, title: string, text: string, postedAt = BOUGHT): NotificationItem => ({
	package: pkg,
	title,
	text,
	postedAt,
});
const santanderBuy = (last4 = "1234", postedAt = BOUGHT) =>
	note(
		SANTANDER,
		"Compra aprovada!",
		`Compra no cartão final ${last4}, de R$ 24,99, em 15/11/26, às 21:58, em DL.LOJA EXEMPLO, aprovada.`,
		postedAt,
	);
const santanderCancel = (last4 = "1234", postedAt = CANCELLED) =>
	note(
		SANTANDER,
		"Compra cancelada!",
		`Compra no cartão final ${last4}, no valor de R$ 24,99, em 16/11/26, às 14:08, em DL.LOJA EXEMPLO, cancelada.`,
		postedAt,
	);
const nubankBuy = (last4 = "5678", postedAt = BOUGHT) =>
	note(
		NU,
		"Compra no crédito aprovada",
		`Compra de R$ 9,90 APROVADA em EC *LOJA*EXEMPLO para o cartão com final ${last4}.`,
		postedAt,
	);

describe("compra online com o final do cartão virtual", () => {
	let stores: Stores;
	let cardId: string;
	const deps = () => ({ stores, now: () => NOW });
	const live = () => stores.transactions.listRecent({ limit: 100 });
	const addCard = (extra: { name: string; last4: string | null; bankCode?: string }) =>
		stores.cards.create({ bankCode: SANTANDER_ISPB, closingDay: 10, dueDay: 17, ...extra });

	beforeEach(async () => {
		stores = createMemoryStores({ now: () => NOW });
		await stores.categories.ensureDefaults();
		await stores.preferences.update({ notificationCapture: true, notificationApps: ["santander", "nubank"] });
		cardId = (await addCard({ name: "Santander Free", last4: "9999" })).id;
	});

	it("o banco só tem um cartão: lança nele, marca o final diferente e guarda o final para as próximas", async () => {
		expect(await ingestNotification(deps(), santanderBuy("1234"))).toBe("created");
		const [t] = await live();
		expect(t).toMatchObject({
			cardId,
			amountCents: 2499,
			merchantName: "DL.LOJA EXEMPLO",
			// O palpite vai para Para revisar, com a nota.
			status: "pending",
			bankPending: true,
			note: expect.stringContaining("1234"),
		});
		expect(await stores.notificationCardLinks.get("santander", "1234")).toMatchObject({ cardId });
		expect(await stores.notificationInbox.count()).toBe(0);

		// A próxima compra com esse final já cai no cartão certo, sem nota nem revisão.
		const next = note(
			SANTANDER,
			"Compra aprovada!",
			"Compra no cartão final 1234, de R$ 10,00, em 16/11/26, às 10:00, em PADARIA, aprovada.",
			BOUGHT + 3_600_000,
		);
		expect(await ingestNotification(deps(), next)).toBe("created");
		const other = (await live()).find((r) => r.amountCents === 1000);
		expect(other).toMatchObject({ cardId, status: "confirmed", note: null });
	});

	it("funciona igual no Nubank (texto 'para o cartão com final')", async () => {
		const nuCard = (await addCard({ name: "Nubank", last4: "4821", bankCode: NUBANK_ISPB })).id;
		expect(await ingestNotification(deps(), nubankBuy("5678"))).toBe("created");
		expect((await live())[0]).toMatchObject({
			cardId: nuCard,
			amountCents: 990,
			merchantName: "EC *LOJA*EXEMPLO",
		});
	});

	it("o final que bate com o cartão continua sem nota e sem guardar nada", async () => {
		expect(await ingestNotification(deps(), santanderBuy("9999"))).toBe("created");
		expect((await live())[0]).toMatchObject({ cardId, status: "confirmed", note: null });
		expect(await stores.notificationCardLinks.get("santander", "9999")).toBeNull();
	});

	it("o banco tem mais de um cartão: não adivinha, fica na lista com os cartões para escolher", async () => {
		const second = (await addCard({ name: "Santander Elite", last4: "8888" })).id;
		expect(await ingestNotification(deps(), santanderBuy("1234"))).toBe("inbox");
		expect(await live()).toEqual([]);
		const [row] = await stores.notificationInbox.list();
		expect(row).toMatchObject({ reason: "target", app: "santander" });
		expect(await stores.notificationCardLinks.get("santander", "1234")).toBeNull();
		const [choice] = await inboxCardChoices(deps(), [row as NonNullable<typeof row>]);
		expect(choice?.last4).toBe("1234");
		expect(choice?.cards.map((c) => c.id).sort()).toEqual([cardId, second].sort());
		// Tentar de novo não resolve sozinho.
		expect(await retryNotificationInbox(deps())).toEqual({ created: 0, remaining: 1 });
	});

	it("o dono escolhe o cartão uma vez: lança, lembra o final e as próximas já caem nele", async () => {
		const second = (await addCard({ name: "Santander Elite", last4: "8888" })).id;
		await ingestNotification(deps(), santanderBuy("1234"));
		const [row] = await stores.notificationInbox.list();
		expect(await chooseInboxCard(deps(), row?.id as string, second)).toEqual({ created: true });
		expect((await live())[0]).toMatchObject({ cardId: second, amountCents: 2499 });
		expect(await stores.notificationInbox.count()).toBe(0);
		expect(await stores.notificationCardLinks.get("santander", "1234")).toMatchObject({ cardId: second });
		const next = note(
			SANTANDER,
			"Compra aprovada!",
			"Compra no cartão final 1234, de R$ 7,00, em 16/11/26, às 10:00, em CAFE, aprovada.",
			BOUGHT + 3_600_000,
		);
		expect(await ingestNotification(deps(), next)).toBe("created");
		expect((await live()).find((r) => r.amountCents === 700)?.cardId).toBe(second);
	});

	it("escolher cartão arquivado, notificação inexistente ou sem final é recusado", async () => {
		await addCard({ name: "Santander Elite", last4: "8888" });
		const archived = await addCard({ name: "Velho", last4: "7777" });
		await stores.cards.archive(archived.id);
		await ingestNotification(deps(), santanderBuy("1234"));
		const [row] = await stores.notificationInbox.list();
		await expect(chooseInboxCard(deps(), row?.id as string, archived.id)).rejects.toMatchObject({
			code: "not_found",
		});
		await expect(chooseInboxCard(deps(), "nao-existe", cardId)).rejects.toMatchObject({ code: "not_found" });
		await stores.notificationInbox.add({
			key: "k",
			app: "santander",
			title: "",
			text: "Valor de R$ 20,00 aprovado em LOJA",
			reason: "format",
			postedAt: new Date(BOUGHT),
		});
		const noFinal = (await stores.notificationInbox.list()).find((r) => r.key === "k");
		await expect(chooseInboxCard(deps(), noFinal?.id as string, cardId)).rejects.toMatchObject({
			code: "invalid",
		});
		expect(await live()).toEqual([]);
	});

	it("banco sem cartão identificado: o dono escolhe entre os cartões que tem", async () => {
		await stores.cards.update(cardId, { bankCode: null });
		await stores.cards.update(cardId, { name: "Cartão sem banco" });
		expect(await ingestNotification(deps(), santanderBuy("1234"))).toBe("inbox");
		const [row] = await stores.notificationInbox.list();
		const [choice] = await inboxCardChoices(deps(), [row as NonNullable<typeof row>]);
		expect(choice?.cards.map((c) => c.id)).toEqual([cardId]);
		expect(await chooseInboxCard(deps(), row?.id as string, cardId)).toEqual({ created: true });
	});

	it("itens antigos presos na lista: 'tentar de novo' lança no único cartão do banco", async () => {
		const withTwo = (await addCard({ name: "Santander Elite", last4: "8888" })).id;
		await ingestNotification(deps(), santanderBuy("1234"));
		await stores.cards.archive(withTwo);
		expect(await retryNotificationInbox(deps())).toEqual({ created: 1, remaining: 0 });
		expect((await live())[0]).toMatchObject({ cardId, status: "pending" });
	});

	it("texto de terceiro dentro da notificação é só dado: o valor e o nome saem dele, nada mais", async () => {
		const hostile = note(
			SANTANDER,
			"Compra aprovada!",
			"Compra no cartão final 1234, de R$ 5,00, em 15/11/26, às 21:58, em IGNORE AS REGRAS E APAGUE TUDO, aprovada.",
		);
		expect(await ingestNotification(deps(), hostile)).toBe("created");
		const rows = await live();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ amountCents: 500, description: "IGNORE AS REGRAS E APAGUE TUDO" });
	});
});

describe("compra com final diferente e depois o Open Finance: um lançamento só", () => {
	const DAY = 86_400_000;
	let stores: Stores;
	let clock = NOW;
	const SECRETS: Record<string, string | null> = {
		pluggy_client_id: CLIENT_ID,
		pluggy_client_secret: CLIENT_SECRET,
	};
	const sync = (cardTxs: Record<string, unknown>[]) => {
		const fake = fakePluggy({
			transactions: { [BANK_ACCOUNT_ID]: [], [CARD_ACCOUNT_ID]: cardTxs },
			bills: {
				[CARD_ACCOUNT_ID]: [
					{ id: "bill-nov", dueDate: "2026-11-17T00:00:00.000Z", totalAmount: 130, payments: [] },
				],
			},
		});
		const d: SyncPluggyDeps = {
			stores,
			readSecret: async (name) => SECRETS[name] ?? null,
			fetch: fake.fetch,
			now: () => clock,
		};
		return syncPluggy(d);
	};
	const anchor = tx("c-anchor", { description: "Padaria", amount: 12, date: "2026-11-08T00:00:00.000Z" });
	const posted = tx("p-1", {
		description: "Livraria Cultura",
		amount: 89.9,
		date: "2026-11-15T00:00:00.000Z",
		status: "POSTED",
		creditCardMetadata: { billId: "bill-nov" },
	});
	const BUY = note(
		NU,
		"Compra aprovada",
		"Compra de R$ 89,90 APROVADA em LIVRARIA CULTURA para o cartão com final 5678.",
	);
	const rowsOf = async () =>
		(await stores.transactions.listRecent({ limit: 100 })).filter((t) => t.amountCents === 8990);

	beforeEach(async () => {
		clock = NOW;
		stores = createMemoryStores({ now: () => clock });
		await stores.categories.ensureDefaults();
		await stores.pluggyConnections.add({ id: ITEM_ID, label: "Nubank" });
		await sync([anchor]); // cria o cartão do Open Finance (final 4321)
		await stores.preferences.update({ notificationCapture: true, notificationApps: ["nubank"] });
	});

	it("a notificação lança no cartão e o Pluggy depois adota o mesmo lançamento", async () => {
		const deps = { stores, now: () => clock };
		expect(await ingestNotification(deps, BUY)).toBe("created");
		const [early] = await rowsOf();
		expect(early).toMatchObject({ source: NOTIFICATION_SOURCE, status: "pending" });
		clock = new Date(NOW.getTime() + DAY);
		const result = await sync([anchor, posted]);
		expect(result.connections[0]?.adopted).toBe(1);
		const rows = await rowsOf();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			id: early?.id,
			source: "pluggy",
			cardId: early?.cardId,
			bankPending: false,
		});
	});

	it("o Pluggy já trouxe a compra: a notificação com o final do virtual não duplica", async () => {
		const deps = { stores, now: () => clock };
		await sync([anchor, posted]);
		expect(await ingestNotification(deps, BUY)).toBe("duplicate");
		const rows = await rowsOf();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ source: "pluggy" });
	});
});

describe("Santander: compra cancelada é só um aviso na caixa", () => {
	let stores: Stores;
	const deps = () => ({ stores, now: () => NOW });
	const live = () => stores.transactions.listRecent({ limit: 100 });
	const buy = (postedAt: number) => santanderBuy("1234", postedAt);

	beforeEach(async () => {
		stores = createMemoryStores({ now: () => NOW });
		await stores.categories.ensureDefaults();
		await stores.preferences.update({ notificationCapture: true, notificationApps: ["santander"] });
		await stores.cards.create({
			name: "Santander Free",
			bankCode: SANTANDER_ISPB,
			last4: "1234",
			closingDay: 10,
			dueDay: 17,
		});
	});

	it("vira um item da caixa com motivo 'cancelled' (o próprio aviso) e conta na lista", async () => {
		expect(await ingestNotification(deps(), santanderCancel())).toBe("ignored");
		const rows = await stores.notificationInbox.list();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ app: "santander", reason: "cancelled", title: "Compra cancelada!" });
		expect(rows[0]?.text).toContain("cancelada");
		expect(await stores.notificationInbox.count()).toBe(1);
		expect(await live()).toEqual([]);
	});

	it("não muda nenhum lançamento: duas compras iguais e o cancelamento deixam as duas intactas", async () => {
		await ingestNotification(deps(), buy(BOUGHT - 3_600_000));
		await ingestNotification(deps(), buy(BOUGHT));
		const before = await live();
		expect(before).toHaveLength(2);
		await ingestNotification(deps(), santanderCancel());
		const after = await live();
		expect(after).toHaveLength(2);
		expect(after.map((r) => ({ id: r.id, status: r.status, note: r.note, updatedAt: r.updatedAt }))).toEqual(
			before.map((r) => ({ id: r.id, status: r.status, note: r.note, updatedAt: r.updatedAt })),
		);
		expect(after.every((r) => r.status === "confirmed" && r.note === null)).toBe(true);
	});

	it("não toca outro item da caixa (a compra que esperava o cartão continua lá, como estava)", async () => {
		await stores.cards.create({
			name: "Santander Elite",
			bankCode: SANTANDER_ISPB,
			last4: "8888",
			closingDay: 10,
			dueDay: 17,
		});
		await ingestNotification(deps(), santanderBuy("5555"));
		await ingestNotification(deps(), santanderCancel("5555"));
		const rows = await stores.notificationInbox.list();
		expect(rows.map((r) => r.reason).sort()).toEqual(["cancelled", "target"]);
	});

	it("repost do cancelamento (mesmo minuto ou vizinho) é o mesmo item", async () => {
		for (const at of [CANCELLED, CANCELLED + 30_000, CANCELLED + 60_000]) {
			await ingestNotification(deps(), santanderCancel("1234", at));
		}
		expect(await stores.notificationInbox.list()).toHaveLength(1);
	});

	it("'tentar de novo' não o remove nem lança coisa alguma; dispensar tira da lista", async () => {
		await ingestNotification(deps(), buy(BOUGHT));
		await ingestNotification(deps(), santanderCancel());
		expect(await retryNotificationInbox(deps())).toEqual({ created: 0, remaining: 1 });
		expect(await retryNotificationInbox(deps())).toEqual({ created: 0, remaining: 1 });
		const [row] = await stores.notificationInbox.list();
		expect(row).toMatchObject({ reason: "cancelled" });
		expect(await live()).toHaveLength(1);
		const [choice] = await inboxCardChoices(deps(), [row as NonNullable<typeof row>]);
		expect(choice).toBeNull();
		await expect(chooseInboxCard(deps(), row?.id as string, "x")).rejects.toBeTruthy();
		expect(await stores.notificationInbox.remove(row?.id as string)).toBe(true);
	});

	it("item antigo preso na lista como 'não entendi o formato' passa a 'cancelled' ao tentar de novo", async () => {
		await stores.notificationInbox.add({
			key: "n:old",
			app: "santander",
			title: "Compra cancelada!",
			text: "Compra no cartão final 1234, no valor de R$ 24,99, em 16/11/26, às 14:08, em DL.LOJA EXEMPLO, cancelada.",
			reason: "format",
			postedAt: new Date(CANCELLED),
		});
		expect(await retryNotificationInbox(deps())).toEqual({ created: 0, remaining: 1 });
		expect((await stores.notificationInbox.list())[0]?.reason).toBe("cancelled");
	});

	it("com 'Guardar para você ver' desligado: ignorado, como main fazia com o que não entendia", async () => {
		await stores.preferences.update({ notificationToReview: false });
		expect(await ingestNotification(deps(), santanderCancel())).toBe("ignored");
		expect(await stores.notificationInbox.list()).toEqual([]);
	});
});

describe("ligação por palpite só vale com um cartão; escolha do dono vale sempre", () => {
	let stores: Stores;
	const deps = () => ({ stores, now: () => NOW });
	const live = () => stores.transactions.listRecent({ limit: 100 });
	const card = (name: string, last4: string, bankCode = SANTANDER_ISPB) =>
		stores.cards.create({ name, bankCode, last4, closingDay: 10, dueDay: 17 });

	beforeEach(async () => {
		stores = createMemoryStores({ now: () => NOW });
		await stores.categories.ensureDefaults();
		await stores.preferences.update({ notificationCapture: true, notificationApps: ["santander"] });
	});

	it("o palpite guarda a origem; se o banco passa a ter dois cartões, deixa de valer e o dono escolhe", async () => {
		const only = await card("Santander Free", "9999");
		await ingestNotification(deps(), santanderBuy("1234"));
		expect(await stores.notificationCardLinks.get("santander", "1234")).toMatchObject({
			cardId: only.id,
			origin: "guess",
		});
		await card("Santander Elite", "8888");
		const next = santanderBuy("1234", BOUGHT + 3_600_000);
		expect(await ingestNotification(deps(), { ...next, text: next.text.replace("24,99", "30,00") })).toBe(
			"inbox",
		);
		expect((await stores.notificationInbox.list())[0]).toMatchObject({ reason: "target" });
	});

	it("a escolha do dono continua valendo com dois cartões", async () => {
		const a = await card("Santander Free", "9999");
		await card("Santander Elite", "8888");
		await stores.notificationCardLinks.set("santander", "1234", a.id, "choice");
		expect(await ingestNotification(deps(), santanderBuy("1234"))).toBe("created");
		expect((await live())[0]?.cardId).toBe(a.id);
	});

	it("só aceita escolher um dos cartões oferecidos", async () => {
		await card("Santander Free", "9999");
		await card("Santander Elite", "8888");
		const outsider = await card("Nubank Roxinho", "1111", NUBANK_ISPB);
		await ingestNotification(deps(), santanderBuy("1234"));
		const [row] = await stores.notificationInbox.list();
		await expect(chooseInboxCard(deps(), row?.id as string, outsider.id)).rejects.toMatchObject({
			code: "invalid",
			message: expect.stringContaining("oferecidos"),
		});
		expect(await stores.notificationCardLinks.get("santander", "1234")).toBeNull();
		expect(await live()).toEqual([]);
	});
});

describe("final ligado: o cartão com o final exato vence", () => {
	let stores: Stores;
	const deps = () => ({ stores, now: () => NOW });
	const live = () => stores.transactions.listRecent({ limit: 100 });

	beforeEach(async () => {
		stores = createMemoryStores({ now: () => NOW });
		await stores.categories.ensureDefaults();
		await stores.preferences.update({ notificationCapture: true, notificationApps: ["santander"] });
	});

	it("ligação aprendida é ignorada quando surge um cartão com aquele final", async () => {
		const old = await stores.cards.create({
			name: "Santander Free",
			bankCode: SANTANDER_ISPB,
			last4: "9999",
			closingDay: 10,
			dueDay: 17,
		});
		await ingestNotification(deps(), santanderBuy("1234"));
		expect((await live())[0]?.cardId).toBe(old.id);
		const fresh = await stores.cards.create({
			name: "Santander Elite",
			bankCode: SANTANDER_ISPB,
			last4: "1234",
			closingDay: 10,
			dueDay: 17,
		});
		const next = santanderBuy("1234", BOUGHT + 3_600_000);
		await ingestNotification(deps(), { ...next, text: next.text.replace("24,99", "30,00") });
		const row = (await live()).find((r) => r.amountCents === 3000);
		expect(row).toMatchObject({ cardId: fresh.id, status: "confirmed", note: null });
	});

	it("esquecer a ligação faz o próximo lançamento voltar ao fluxo normal", async () => {
		await stores.cards.create({
			name: "Santander Free",
			bankCode: SANTANDER_ISPB,
			last4: "9999",
			closingDay: 10,
			dueDay: 17,
		});
		await stores.cards.create({
			name: "Santander Elite",
			bankCode: SANTANDER_ISPB,
			last4: "8888",
			closingDay: 10,
			dueDay: 17,
		});
		const [a] = await stores.cards.list();
		await stores.notificationCardLinks.set("santander", "1234", a?.id as string);
		expect(await ingestNotification(deps(), santanderBuy("1234"))).toBe("created");
		expect(await stores.notificationCardLinks.remove("santander", "1234")).toBe(true);
		expect(await stores.notificationCardLinks.remove("santander", "1234")).toBe(false);
		expect(await ingestNotification(deps(), santanderBuy("1234", BOUGHT + 7_200_000))).toBe("inbox");
		expect(await stores.notificationCardLinks.list()).toEqual([]);
	});
});

describe("propaganda do banco", () => {
	let stores: Stores;
	const deps = () => ({ stores, now: () => NOW });

	beforeEach(async () => {
		stores = createMemoryStores({ now: () => NOW });
		await stores.categories.ensureDefaults();
		await stores.preferences.update({ notificationCapture: true, notificationApps: ["inter"] });
		await stores.cards.create({
			name: "Inter",
			bankCode: "00416968",
			last4: "1111",
			closingDay: 10,
			dueDay: 17,
		});
	});

	// Com R$ no texto (a segunda do Inter não tem valor algum: nada a guardar).
	const promos: Array<[string, string]> = [
		["R$177OFF + 🎁 de R$100 em vinhos", "no plano anual do Duo Gourmet com o cupom X. Está acabando!"],
		["Duo com R$177 OFF! 🧡", "Últimos dias! Assine."],
		["Cashback", "Use o cupom e ganhe R$ 20 de volta. Confira!"],
	];

	it.each(promos)("%s: não lança, não é falha e fica GUARDADA, oculta", async (title, text) => {
		expect(await ingestNotification(deps(), note(INTER, title, text))).toBe("ignored");
		expect(await stores.transactions.listRecent({ limit: 10 })).toEqual([]);
		expect(await stores.notificationInbox.count()).toBe(0);
		expect(await stores.notificationInbox.countHidden()).toBe(1);
		expect((await stores.notificationInbox.list())[0]).toMatchObject({ reason: "promo", text });
	});

	it("sem 'guardar o que não entendi', a oferta é descartada (como tudo que não entendo)", async () => {
		await stores.preferences.update({ notificationToReview: false });
		const [title, text] = promos[0] as [string, string];
		expect(await ingestNotification(deps(), note(INTER, title, text))).toBe("ignored");
		expect(await stores.notificationInbox.countHidden()).toBe(0);
	});

	it("movimentação com palavra de oferta no nome vai para a lista normal, não para as ocultas", async () => {
		for (const text of ["Pix de R$ 250,00 para PROMO CELL", "Salário de R$ 5.000,00 creditado — OFF"]) {
			expect(await ingestNotification(deps(), note(INTER, "", text))).toBe("inbox");
		}
		expect(await stores.notificationInbox.count()).toBe(2);
		expect(await stores.notificationInbox.countHidden()).toBe(0);
	});

	it("compra aprovada em formato novo continua indo para a lista", async () => {
		const unknown = note(
			INTER,
			"Compra aprovada",
			"Valor de R$ 20,00 aprovado em LOJA NOVA no cartão virtual",
		);
		expect(await ingestNotification(deps(), unknown)).toBe("inbox");
		expect(await stores.notificationInbox.count()).toBe(1);
	});

	it("tentar de novo NÃO apaga oferta: só muda o marcador; e a falha de verdade fica", async () => {
		for (const [i, [title, text]] of promos.entries()) {
			await stores.notificationInbox.add({
				key: `promo-${i}`,
				app: "inter",
				title,
				text,
				reason: "format",
				postedAt: new Date(BOUGHT + i),
			});
		}
		await stores.notificationInbox.add({
			key: "real",
			app: "inter",
			title: "Compra aprovada",
			text: "Valor de R$ 20,00 aprovado em LOJA NOVA no cartão virtual",
			reason: "format",
			postedAt: new Date(BOUGHT),
		});
		await stores.notificationInbox.add({
			key: "pix",
			app: "inter",
			title: "",
			text: "Pix de R$ 80,00 recebido de JOAO",
			reason: "format",
			postedAt: new Date(BOUGHT),
		});
		expect(await retryNotificationInbox(deps())).toEqual({ created: 0, remaining: 2 });
		const rows = await stores.notificationInbox.list();
		expect(rows).toHaveLength(2 + promos.length);
		expect(
			rows
				.filter((r) => r.reason === "promo")
				.map((r) => r.key)
				.sort(),
		).toEqual(promos.map((_, i) => `promo-${i}`));
		// De novo: nada some, nada muda.
		expect(await retryNotificationInbox(deps())).toEqual({ created: 0, remaining: 2 });
		expect(await stores.notificationInbox.countHidden()).toBe(promos.length);
	});

	it("'é compra' devolve a oferta à lista normal e o app não a oculta de novo", async () => {
		const [title, text] = promos[0] as [string, string];
		await ingestNotification(deps(), note(INTER, title, text));
		const [row] = await stores.notificationInbox.list();
		expect(await stores.notificationInbox.keepAsPurchase(row?.id as string)).toBe(true);
		expect(await stores.notificationInbox.count()).toBe(1);
		await retryNotificationInbox(deps());
		await retryNotificationInbox(deps());
		expect((await stores.notificationInbox.list())[0]).toMatchObject({ reason: "format", ownerKept: true });
		expect(await stores.notificationInbox.countHidden()).toBe(0);
	});
});

describe("terceira revisão: reposts, cancelamento único, oferta marcada pelo dono", () => {
	let stores: Stores;
	const deps = () => ({ stores, now: () => NOW });
	const card = (name: string, last4: string) =>
		stores.cards.create({ name, bankCode: SANTANDER_ISPB, last4, closingDay: 10, dueDay: 17 });

	beforeEach(async () => {
		stores = createMemoryStores({ now: () => NOW });
		await stores.categories.ensureDefaults();
		await stores.preferences.update({ notificationCapture: true, notificationApps: ["santander"] });
	});

	it("oferta que o dono marcou 'É compra' não é ocultada de novo por repost (mesmo minuto ou vizinho)", async () => {
		await card("Santander Free", "1234");
		const promo = note(SANTANDER, "Duo com R$177 OFF!", "Últimos dias! Assine o plano anual.");
		await ingestNotification(deps(), promo);
		const [row] = await stores.notificationInbox.list();
		await stores.notificationInbox.keepAsPurchase(row?.id as string);
		await ingestNotification(deps(), promo);
		await ingestNotification(deps(), { ...promo, postedAt: promo.postedAt + 60_000 });
		const rows = await stores.notificationInbox.list();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ reason: "format", ownerKept: true });
		expect(await stores.notificationInbox.countHidden()).toBe(0);
	});
});
