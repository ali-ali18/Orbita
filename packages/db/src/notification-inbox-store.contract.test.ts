import { beforeEach, describe, expect, it } from "vitest";
import { contractSuites } from "./contract-harness.ts";
import { NOTIFICATION_INBOX_LIMIT } from "./notification-inbox-store.ts";
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
});
