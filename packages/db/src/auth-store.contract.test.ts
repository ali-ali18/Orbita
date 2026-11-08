import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthStore } from "./auth-store.ts";
import { createDb, type Db } from "./client.ts";
import { createMemoryAuthStore } from "./memory-auth-store.ts";
import { createPrismaAuthStore } from "./prisma-auth-store.ts";

const t0 = new Date("2026-11-06T12:00:00Z");
const at = (min: number) => new Date(t0.getTime() + min * 60_000);

// O Postgres entra quando DATABASE_URL_TEST aponta para um banco descartável (CI e máquina local).
const testUrl = process.env.DATABASE_URL_TEST;
let db: Db | undefined;

const suites: Array<[string, () => Promise<AuthStore>]> = [["memória", async () => createMemoryAuthStore()]];
if (testUrl) {
	suites.push([
		"postgres",
		async () => {
			db ??= createDb(testUrl);
			await db.device.deleteMany();
			await db.pairingCode.deleteMany();
			return createPrismaAuthStore(db);
		},
	]);
}

afterAll(async () => {
	await db?.$disconnect();
});

describe.each(suites)("AuthStore (%s)", (_name, make) => {
	let store: AuthStore;
	beforeEach(async () => {
		store = await make();
	});

	it("renomeia o aparelho conectado e ignora o revogado ou inexistente", async () => {
		const c = await store.replaceActivePairingCode({ codeHash: "a", expiresAt: at(10), now: t0 });
		const device = await store.consumePairingCode({
			codeId: c.id,
			now: at(1),
			deviceName: "A",
			tokenHash: "t",
		});
		if (!device) throw new Error("aparelho não criado");
		const renamed = await store.renameDevice({ deviceId: device.id, name: "Galaxy" });
		expect(renamed).toMatchObject({ id: device.id, name: "Galaxy" });
		expect((await store.findDeviceById(device.id))?.name).toBe("Galaxy");
		expect(await store.renameDevice({ deviceId: "inexistente", name: "X" })).toBeNull();
		await store.revokeDevice({ deviceId: device.id, now: at(2) });
		expect(await store.renameDevice({ deviceId: device.id, name: "Outro" })).toBeNull();
		expect((await store.findDeviceById(device.id))?.name).toBe("Galaxy");
	});

	it("mantém um só código ativo", async () => {
		const a = await store.replaceActivePairingCode({ codeHash: "a", expiresAt: at(10), now: t0 });
		const b = await store.replaceActivePairingCode({ codeHash: "b", expiresAt: at(11), now: at(1) });
		const active = await store.findActivePairingCode(at(2), 5);
		expect(active?.id).toBe(b.id);
		expect(active?.id).not.toBe(a.id);
	});

	it("não devolve código expirado", async () => {
		await store.replaceActivePairingCode({ codeHash: "a", expiresAt: at(10), now: t0 });
		expect(await store.findActivePairingCode(at(10), 5)).toBeNull();
	});

	it("mata o código ao chegar no limite de tentativas", async () => {
		const c = await store.replaceActivePairingCode({ codeHash: "a", expiresAt: at(10), now: t0 });
		for (let i = 0; i < 4; i++)
			expect(await store.reserveAttempt({ codeId: c.id, maxAttempts: 5, now: at(1) })).toBe(true);
		expect(await store.findActivePairingCode(at(1), 5)).not.toBeNull();
		expect(await store.reserveAttempt({ codeId: c.id, maxAttempts: 5, now: at(1) })).toBe(true);
		expect(await store.findActivePairingCode(at(1), 5)).toBeNull();
		expect(await store.reserveAttempt({ codeId: c.id, maxAttempts: 5, now: at(1) })).toBe(false);
	});

	it("reservas concorrentes nunca passam do limite", async () => {
		const c = await store.replaceActivePairingCode({ codeHash: "a", expiresAt: at(10), now: t0 });
		const results = await Promise.all(
			Array.from({ length: 20 }, () => store.reserveAttempt({ codeId: c.id, maxAttempts: 5, now: at(1) })),
		);
		expect(results.filter(Boolean)).toHaveLength(5);
	});

	it("não reserva tentativa em código expirado, usado ou inexistente", async () => {
		const c = await store.replaceActivePairingCode({ codeHash: "a", expiresAt: at(10), now: t0 });
		expect(await store.reserveAttempt({ codeId: c.id, maxAttempts: 5, now: at(10) })).toBe(false);
		expect(await store.reserveAttempt({ codeId: "inexistente", maxAttempts: 5, now: at(1) })).toBe(false);
		await store.consumePairingCode({ codeId: c.id, now: at(1), deviceName: "A", tokenHash: "t" });
		expect(await store.reserveAttempt({ codeId: c.id, maxAttempts: 5, now: at(2) })).toBe(false);
	});

	it("gasta o código uma vez só, mesmo com dois pedidos ao mesmo tempo", async () => {
		const c = await store.replaceActivePairingCode({ codeHash: "a", expiresAt: at(10), now: t0 });
		const [x, y] = await Promise.all([
			store.consumePairingCode({ codeId: c.id, now: at(1), deviceName: "A", tokenHash: "ta" }),
			store.consumePairingCode({ codeId: c.id, now: at(1), deviceName: "B", tokenHash: "tb" }),
		]);
		expect([x, y].filter(Boolean)).toHaveLength(1);
		expect(await store.findActivePairingCode(at(2), 5)).toBeNull();
	});

	it("não gasta código expirado", async () => {
		const c = await store.replaceActivePairingCode({ codeHash: "a", expiresAt: at(10), now: t0 });
		expect(
			await store.consumePairingCode({ codeId: c.id, now: at(10), deviceName: "A", tokenHash: "t" }),
		).toBeNull();
	});

	it("acha o aparelho pelo hash do token e revoga", async () => {
		const c = await store.replaceActivePairingCode({ codeHash: "a", expiresAt: at(10), now: t0 });
		const d = await store.consumePairingCode({
			codeId: c.id,
			now: at(1),
			deviceName: "Galaxy",
			tokenHash: "th",
		});
		expect(d?.name).toBe("Galaxy");
		const found = await store.findDeviceByTokenHash("th");
		expect(found?.id).toBe(d?.id);
		await store.revokeDevice({ deviceId: d?.id ?? "", now: at(2) });
		expect((await store.findDeviceByTokenHash("th"))?.revokedAt).toEqual(at(2));
	});

	it("apaga códigos velhos e mantém o ativo", async () => {
		await store.replaceActivePairingCode({ codeHash: "velho", expiresAt: at(10), now: t0 });
		const novo = await store.replaceActivePairingCode({ codeHash: "novo", expiresAt: at(70), now: at(60) });
		expect(await store.deleteStalePairingCodes(at(60))).toBe(1);
		expect((await store.findActivePairingCode(at(61), 5))?.id).toBe(novo.id);
	});

	it("conta só os aparelhos não revogados", async () => {
		expect(await store.countActiveDevices()).toBe(0);
		const c = await store.replaceActivePairingCode({ codeHash: "a", expiresAt: at(10), now: t0 });
		const d = await store.consumePairingCode({ codeId: c.id, now: at(1), deviceName: "A", tokenHash: "ta" });
		expect(await store.countActiveDevices()).toBe(1);
		await store.revokeDevice({ deviceId: d?.id ?? "", now: at(2) });
		expect(await store.countActiveDevices()).toBe(0);
	});
});
