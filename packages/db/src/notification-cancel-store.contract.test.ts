import { beforeEach, describe, expect, it } from "vitest";
import { contractSuites } from "./contract-harness.ts";
import type { Stores } from "./stores.ts";

const POSTED = new Date("2026-11-16T17:08:00Z");
const input = (
	key: string,
	extra: Partial<Parameters<Stores["notificationCancellations"]["register"]>[0]> = {},
) => ({
	key,
	app: "santander" as const,
	last4: "1234",
	amountCents: 2499,
	merchant: "LOJA EXEMPLO",
	postedAt: POSTED,
	consumed: false,
	...extra,
});

describe.each(contractSuites())("NotificationCancelStore (%s)", (_name, make) => {
	let store: Stores["notificationCancellations"];
	beforeEach(async () => {
		store = (await make()).notificationCancellations;
	});

	it("registra uma vez por chave e não troca o que já estava", async () => {
		expect(await store.register(input("a"))).toEqual({ created: true });
		expect(await store.register(input("a", { amountCents: 100 }))).toEqual({ created: false });
		const [row] = await store.listPending("santander", new Date(0));
		expect(row).toMatchObject({ key: "a", amountCents: 2499, merchant: "LOJA EXEMPLO", consumedAt: null });
	});

	it("hasAny diz se alguma chave já foi registrada", async () => {
		await store.register(input("a"));
		expect(await store.hasAny(["x", "a"])).toBe(true);
		expect(await store.hasAny(["x", "y"])).toBe(false);
		expect(await store.hasAny([])).toBe(false);
	});

	it("lista só os pendentes do app, a partir do horário", async () => {
		await store.register(input("a"));
		await store.register(input("old", { postedAt: new Date("2026-11-01T00:00:00Z") }));
		await store.register(input("used", { consumed: true }));
		await store.register(input("other", { app: "nubank" }));
		const rows = await store.listPending("santander", new Date("2026-11-10T00:00:00Z"));
		expect(rows.map((r) => r.key)).toEqual(["a"]);
	});

	it("consumir vale uma vez só", async () => {
		await store.register(input("a"));
		expect(await store.consume("a")).toBe(true);
		expect(await store.consume("a")).toBe(false);
		expect(await store.consume("nao-existe")).toBe(false);
		expect(await store.listPending("santander", new Date(0))).toEqual([]);
	});

	it("purgeOlderThan apaga os antigos", async () => {
		await store.register(input("a"));
		expect(await store.purgeOlderThan(new Date("2000-01-01T00:00:00Z"))).toBe(0);
		expect(await store.purgeOlderThan(new Date("2100-01-01T00:00:00Z"))).toBe(1);
		expect(await store.register(input("a"))).toEqual({ created: true });
	});
});
