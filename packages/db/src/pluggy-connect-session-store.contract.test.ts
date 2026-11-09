import { beforeEach, describe, expect, it } from "vitest";
import { contractSuites } from "./contract-harness.ts";
import type { Stores } from "./stores.ts";

const T0 = new Date("2026-11-07T12:00:00Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

describe.each(contractSuites())("PluggyConnectSessionStore (%s)", (_name, make) => {
	let stores: Stores;
	let sessions: Stores["pluggyConnectSessions"];
	let deviceId: string;
	beforeEach(async () => {
		stores = await make();
		sessions = stores.pluggyConnectSessions;
		// A sessão aponta para um aparelho de verdade (chave estrangeira no Postgres).
		await stores.auth.replaceActivePairingCode({ codeHash: "c", expiresAt: minutes(10), now: T0 });
		const code = await stores.auth.findActivePairingCode(T0, 5);
		const device = await stores.auth.consumePairingCode({
			codeId: code?.id ?? "",
			now: T0,
			deviceName: "Teste",
			tokenHash: `t-${Math.random()}`,
		});
		deviceId = device?.id ?? "";
	});

	const create = (tokenHash: string, expiresIn: number, now: Date) =>
		sessions.create({ tokenHash, deviceId, expiresAt: minutes(expiresIn), now });

	it("vale até expirar e devolve o aparelho e a hora de criação", async () => {
		await create("h1", 15, T0);
		expect(await sessions.find("h1", minutes(14))).toEqual({ deviceId, createdAt: T0, updateItemId: null });
		expect(await sessions.find("h1", minutes(15))).toBeNull();
		expect(await sessions.consume("h1", minutes(16))).toBe(false);
		expect(await sessions.find("outro", T0)).toBeNull();
	});

	it("guarda o item a atualizar (reconexão) até a sessão acabar", async () => {
		const item = "11111111-2222-4333-8444-555555555555";
		await sessions.create({ tokenHash: "r1", deviceId, expiresAt: minutes(15), now: T0, updateItemId: item });
		expect(await sessions.find("r1", minutes(1))).toEqual({ deviceId, createdAt: T0, updateItemId: item });
		await sessions.release("r1");
		expect((await sessions.find("r1", minutes(1)))?.updateItemId).toBe(item);
	});

	it("find não gasta; consume gasta uma vez só", async () => {
		await create("h1", 15, T0);
		expect(await sessions.find("h1", minutes(1))).not.toBeNull();
		expect(await sessions.find("h1", minutes(1))).not.toBeNull();
		expect(await sessions.consume("h1", minutes(2))).toBe(true);
		expect(await sessions.consume("h1", minutes(3))).toBe(false);
		expect(await sessions.find("h1", minutes(3))).toBeNull();
	});

	it("release desfaz o consumo para tentar de novo", async () => {
		await create("h1", 15, T0);
		expect(await sessions.consume("h1", minutes(1))).toBe(true);
		await sessions.release("h1");
		expect(await sessions.find("h1", minutes(2))).not.toBeNull();
		expect(await sessions.consume("h1", minutes(2))).toBe(true);
	});

	it("consumo concorrente: só um ganha", async () => {
		await create("h1", 15, T0);
		const results = await Promise.all(Array.from({ length: 8 }, () => sessions.consume("h1", minutes(1))));
		expect(results.filter(Boolean)).toHaveLength(1);
	});

	it("criar outra expira a anterior: só uma fica ativa", async () => {
		await create("h1", 15, T0);
		await create("h2", 20, minutes(1));
		expect(await sessions.find("h1", minutes(2))).toBeNull();
		expect(await sessions.find("h2", minutes(2))).not.toBeNull();
	});

	it("criações simultâneas: só uma fica ativa", async () => {
		const hashes = Array.from({ length: 8 }, (_, i) => `c${i}`);
		await Promise.all(hashes.map((h) => create(h, 15, T0)));
		const active = await Promise.all(hashes.map((h) => sessions.find(h, minutes(1))));
		expect(active.filter((x) => x !== null)).toHaveLength(1);
	});

	it("apaga as usadas e as expiradas antes do limite", async () => {
		await create("h1", 15, T0);
		await sessions.consume("h1", minutes(1));
		await create("h2", 20, minutes(2));
		expect(await sessions.deleteStale(minutes(60))).toBe(2);
		expect(await sessions.deleteStale(minutes(60))).toBe(0);
	});
});
