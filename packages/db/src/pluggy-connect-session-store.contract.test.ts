import { beforeEach, describe, expect, it } from "vitest";
import { contractSuites } from "./contract-harness.ts";
import type { Stores } from "./stores.ts";

const T0 = new Date("2026-11-07T12:00:00Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

describe.each(contractSuites())("PluggyConnectSessionStore (%s)", (_name, make) => {
	let sessions: Stores["pluggyConnectSessions"];
	beforeEach(async () => {
		sessions = (await make()).pluggyConnectSessions;
	});

	it("vale até expirar", async () => {
		await sessions.create({ tokenHash: "h1", expiresAt: minutes(15), now: T0 });
		expect(await sessions.isActive("h1", minutes(14))).toBe(true);
		expect(await sessions.isActive("h1", minutes(15))).toBe(false);
		expect(await sessions.consume("h1", minutes(16))).toBe(false);
		expect(await sessions.isActive("outro", T0)).toBe(false);
	});

	it("isActive não gasta; consume gasta uma vez só", async () => {
		await sessions.create({ tokenHash: "h1", expiresAt: minutes(15), now: T0 });
		expect(await sessions.isActive("h1", minutes(1))).toBe(true);
		expect(await sessions.isActive("h1", minutes(1))).toBe(true);
		expect(await sessions.consume("h1", minutes(2))).toBe(true);
		expect(await sessions.consume("h1", minutes(3))).toBe(false);
		expect(await sessions.isActive("h1", minutes(3))).toBe(false);
	});

	it("consumo concorrente: só um ganha", async () => {
		await sessions.create({ tokenHash: "h1", expiresAt: minutes(15), now: T0 });
		const results = await Promise.all(Array.from({ length: 8 }, () => sessions.consume("h1", minutes(1))));
		expect(results.filter(Boolean)).toHaveLength(1);
	});

	it("criar outra expira a anterior: só uma fica ativa", async () => {
		await sessions.create({ tokenHash: "h1", expiresAt: minutes(15), now: T0 });
		await sessions.create({ tokenHash: "h2", expiresAt: minutes(20), now: minutes(1) });
		expect(await sessions.isActive("h1", minutes(2))).toBe(false);
		expect(await sessions.isActive("h2", minutes(2))).toBe(true);
	});

	it("apaga as usadas e as expiradas antes do limite", async () => {
		await sessions.create({ tokenHash: "h1", expiresAt: minutes(15), now: T0 });
		await sessions.consume("h1", minutes(1));
		await sessions.create({ tokenHash: "h2", expiresAt: minutes(20), now: minutes(2) });
		expect(await sessions.deleteStale(minutes(60))).toBe(2);
		expect(await sessions.deleteStale(minutes(60))).toBe(0);
	});
});
