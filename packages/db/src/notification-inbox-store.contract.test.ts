import { beforeEach, describe, expect, it } from "vitest";
import { contractSuites } from "./contract-harness.ts";
import { NOTIFICATION_INBOX_LIMIT, NOTIFICATION_PROMO_LIMIT } from "./notification-inbox-store.ts";
import type { Stores } from "./stores.ts";

const POSTED = new Date("2026-11-10T12:00:00Z");
const item = (key: string, extra: Partial<Parameters<Stores["notificationInbox"]["add"]>[0]> = {}) => ({
	key,
	app: "nubank" as const,
	title: "Compra",
	text: `Texto ${key}`,
	reason: "format" as const,
	postedAt: POSTED,
	...extra,
});

describe.each(contractSuites())("NotificationInboxStore (%s)", (_name, make) => {
	let inbox: Stores["notificationInbox"];
	beforeEach(async () => {
		inbox = (await make()).notificationInbox;
	});

	it("começa vazia", async () => {
		expect(await inbox.count()).toBe(0);
		expect(await inbox.list()).toEqual([]);
	});

	it("guarda e lista a mais nova primeiro", async () => {
		expect(await inbox.add(item("a"))).toEqual({ created: true });
		expect(await inbox.add(item("b", { app: "inter", reason: "target" }))).toEqual({ created: true });
		const rows = await inbox.list();
		expect(rows.map((r) => r.key)).toEqual(["b", "a"]);
		expect(rows[0]).toMatchObject({
			app: "inter",
			reason: "target",
			title: "Compra",
			text: "Texto b",
			postedAt: POSTED,
		});
		expect(typeof rows[0]?.id).toBe("string");
		expect(await inbox.count()).toBe(2);
		expect((await inbox.list(1)).map((r) => r.key)).toEqual(["b"]);
	});

	it("é idempotente pela chave: repetir não duplica nem troca o que já estava", async () => {
		await inbox.add(item("a"));
		expect(await inbox.add(item("a", { text: "outro texto", reason: "target" }))).toEqual({ created: false });
		const [row] = await inbox.list();
		expect(await inbox.count()).toBe(1);
		expect(row).toMatchObject({ text: "Texto a", reason: "format" });
	});

	it("remove pelo id e diz se existia", async () => {
		await inbox.add(item("a"));
		const [row] = await inbox.list();
		expect(await inbox.remove(row?.id as string)).toBe(true);
		expect(await inbox.remove(row?.id as string)).toBe(false);
		expect(await inbox.count()).toBe(0);
		// Depois de resolvida, a mesma notificação pode voltar à lista.
		expect(await inbox.add(item("a"))).toEqual({ created: true });
	});

	it("purgeOlderThan apaga só as antigas", async () => {
		await inbox.add(item("a"));
		await inbox.add(item("b"));
		await inbox.add(item("c"));
		const rows = await inbox.list();
		const middle = rows[1]?.createdAt as Date;
		expect(await inbox.purgeOlderThan(middle)).toBe(1);
		expect((await inbox.list()).map((r) => r.key)).toEqual(["c", "b"]);
		expect(await inbox.purgeOlderThan(new Date(0))).toBe(0);
	});

	it("guarda no máximo NOTIFICATION_INBOX_LIMIT: as mais antigas saem", async () => {
		for (let i = 0; i < NOTIFICATION_INBOX_LIMIT + 3; i++) await inbox.add(item(`k${i}`));
		expect(await inbox.count()).toBe(NOTIFICATION_INBOX_LIMIT);
		const keys = (await inbox.list()).map((r) => r.key);
		expect(keys[0]).toBe(`k${NOTIFICATION_INBOX_LIMIT + 2}`);
		expect(keys).not.toContain("k0");
		expect(keys).not.toContain("k2");
		expect(keys).toContain("k3");
	});

	it("oferta oculta (promo) guarda, não entra na contagem e tem limite próprio", async () => {
		await inbox.add(item("real", { reason: "format" }));
		await inbox.add(item("oferta", { reason: "promo" }));
		expect(await inbox.count()).toBe(1);
		expect(await inbox.countHidden()).toBe(1);
		expect((await inbox.list()).map((r) => r.key).sort()).toEqual(["oferta", "real"]);
		for (let i = 0; i < NOTIFICATION_PROMO_LIMIT + 5; i++)
			await inbox.add(item(`p${i}`, { reason: "promo" }));
		expect(await inbox.countHidden()).toBe(NOTIFICATION_PROMO_LIMIT);
		// A enxurrada de oferta não expulsa a falha de verdade.
		expect(await inbox.count()).toBe(1);
	});

	it("setReason muda o motivo pela chave; keepAsPurchase devolve a oferta à lista e fixa", async () => {
		await inbox.add(item("a", { reason: "format" }));
		await inbox.setReason("a", "promo");
		expect((await inbox.list())[0]).toMatchObject({ reason: "promo", ownerKept: false });
		await inbox.setReason("nao-existe", "promo");
		const id = (await inbox.list())[0]?.id as string;
		expect(await inbox.keepAsPurchase(id)).toBe(true);
		expect((await inbox.list())[0]).toMatchObject({ reason: "format", ownerKept: true });
		expect(await inbox.count()).toBe(1);
		// Só vale para oferta oculta.
		expect(await inbox.keepAsPurchase(id)).toBe(false);
		expect(await inbox.keepAsPurchase("nao-existe")).toBe(false);
	});

	it("falhas e ofertas têm limites separados e list() devolve todas (100 falhas não somem sob 30 ofertas)", async () => {
		for (let i = 0; i < NOTIFICATION_INBOX_LIMIT; i++) await inbox.add(item(`f${i}`, { reason: "format" }));
		for (let i = 0; i < NOTIFICATION_PROMO_LIMIT; i++) await inbox.add(item(`p${i}`, { reason: "promo" }));
		expect(await inbox.count()).toBe(NOTIFICATION_INBOX_LIMIT);
		expect(await inbox.countHidden()).toBe(NOTIFICATION_PROMO_LIMIT);
		const all = await inbox.list();
		expect(all).toHaveLength(NOTIFICATION_INBOX_LIMIT + NOTIFICATION_PROMO_LIMIT);
		expect(all.filter((r) => r.reason !== "promo")).toHaveLength(NOTIFICATION_INBOX_LIMIT);
	});

	it("setReason('promo') não reoculta o que o dono marcou 'é compra'", async () => {
		await inbox.add(item("a", { reason: "promo" }));
		const id = (await inbox.list())[0]?.id as string;
		await inbox.keepAsPurchase(id);
		await inbox.setReason("a", "promo");
		expect((await inbox.list())[0]).toMatchObject({ reason: "format", ownerKept: true });
		await inbox.setReason("a", "target");
		expect((await inbox.list())[0]?.reason).toBe("target");
	});

	it("aviso de cancelamento (cancelled) não conta como pendência, aparece na lista e o motivo não muda", async () => {
		await inbox.add(item("c", { reason: "cancelled" }));
		expect(await inbox.count()).toBe(0);
		expect(await inbox.countHidden()).toBe(0);
		expect(await inbox.add(item("c", { reason: "cancelled" }))).toEqual({ created: false });
		await inbox.setReason("c", "target");
		await inbox.setReason("c", "promo");
		expect(await inbox.list()).toHaveLength(1);
		expect((await inbox.list())[0]?.reason).toBe("cancelled");
		expect(await inbox.remove((await inbox.list())[0]?.id as string)).toBe(true);
	});

	it("ao estourar o teto das ofertas, sai só a mais antiga", async () => {
		for (let i = 0; i < NOTIFICATION_PROMO_LIMIT + 1; i++)
			await inbox.add(item(`p${i}`, { reason: "promo" }));
		const keys = (await inbox.list()).map((r) => r.key);
		expect(keys).toHaveLength(NOTIFICATION_PROMO_LIMIT);
		expect(keys).not.toContain("p0");
		expect(keys).toContain(`p${NOTIFICATION_PROMO_LIMIT}`);
	});
});
