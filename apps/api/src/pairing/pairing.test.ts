import { createMemoryAuthStore } from "@orbita/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
	authenticateDevice,
	claimPairingCode,
	createPairingCode,
	generatePairingCode,
	hashDeviceToken,
	PAIRING_MAX_ATTEMPTS,
	type PairingDeps,
} from "./pairing.ts";

const secret = "s".repeat(48);
const t0 = new Date("2026-11-06T12:00:00Z");

function setup() {
	const store = createMemoryAuthStore();
	let now = t0;
	const deps: PairingDeps = { store, secret, now: () => now };
	return { store, deps, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

const other = (code: string) => (code === "000000" ? "111111" : "000000");

describe("generatePairingCode", () => {
	it("sempre tem 6 dígitos, inclusive com zeros à esquerda", () => {
		for (let i = 0; i < 200; i++) expect(generatePairingCode()).toMatch(/^\d{6}$/);
	});
});

describe("pareamento", () => {
	let ctx: ReturnType<typeof setup>;
	beforeEach(() => {
		ctx = setup();
	});

	it("troca o código certo por um token e cria o aparelho", async () => {
		const { code } = await createPairingCode(ctx.deps);
		const res = await claimPairingCode(ctx.deps, { code, deviceName: "Galaxy" });
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(res.token).toMatch(/^orb_[A-Za-z0-9_-]{43}$/);
		expect(res.device.name).toBe("Galaxy");
		// O banco guarda só hashes: nem o código nem o token aparecem em texto.
		expect(ctx.store.codes[0]?.codeHash).not.toContain(code);
		expect(ctx.store.devices[0]?.tokenHash).toBe(hashDeviceToken(res.token));
	});

	it("não deixa usar o mesmo código duas vezes", async () => {
		const { code } = await createPairingCode(ctx.deps);
		expect((await claimPairingCode(ctx.deps, { code, deviceName: "A" })).ok).toBe(true);
		expect((await claimPairingCode(ctx.deps, { code, deviceName: "B" })).ok).toBe(false);
	});

	it("recusa o código depois de 10 minutos", async () => {
		const { code } = await createPairingCode(ctx.deps);
		ctx.advance(10 * 60_000);
		expect((await claimPairingCode(ctx.deps, { code, deviceName: "A" })).ok).toBe(false);
	});

	it("um código novo invalida o anterior", async () => {
		const first = await createPairingCode(ctx.deps);
		const second = await createPairingCode(ctx.deps);
		if (first.code !== second.code) {
			expect((await claimPairingCode(ctx.deps, { code: first.code, deviceName: "A" })).ok).toBe(false);
		}
		expect((await claimPairingCode(ctx.deps, { code: second.code, deviceName: "A" })).ok).toBe(true);
	});

	it(`mata o código depois de ${PAIRING_MAX_ATTEMPTS} erros, mesmo que depois venha o certo`, async () => {
		const { code } = await createPairingCode(ctx.deps);
		for (let i = 0; i < PAIRING_MAX_ATTEMPTS; i++) {
			expect((await claimPairingCode(ctx.deps, { code: other(code), deviceName: "X" })).ok).toBe(false);
		}
		expect((await claimPairingCode(ctx.deps, { code, deviceName: "A" })).ok).toBe(false);
	});

	it("sem código ativo, recusa sem contar tentativa", async () => {
		expect((await claimPairingCode(ctx.deps, { code: "123456", deviceName: "A" })).ok).toBe(false);
		expect(ctx.store.codes).toHaveLength(0);
	});
});

describe("authenticateDevice", () => {
	it("aceita o token do aparelho e recusa depois de revogado", async () => {
		const ctx = setup();
		const { code } = await createPairingCode(ctx.deps);
		const res = await claimPairingCode(ctx.deps, { code, deviceName: "Galaxy" });
		if (!res.ok) throw new Error("pareamento falhou");
		expect((await authenticateDevice(ctx.deps, res.token))?.id).toBe(res.device.id);
		await ctx.store.revokeDevice({ deviceId: res.device.id, now: t0 });
		expect(await authenticateDevice(ctx.deps, res.token)).toBeNull();
	});

	it("recusa token desconhecido ou sem prefixo", async () => {
		const ctx = setup();
		expect(await authenticateDevice(ctx.deps, "orb_naoexiste")).toBeNull();
		expect(await authenticateDevice(ctx.deps, "qualquer-coisa")).toBeNull();
	});

	it("atualiza 'visto por último' no máximo a cada 5 minutos", async () => {
		const ctx = setup();
		const { code } = await createPairingCode(ctx.deps);
		const res = await claimPairingCode(ctx.deps, { code, deviceName: "Galaxy" });
		if (!res.ok) throw new Error("pareamento falhou");
		ctx.advance(60_000);
		await authenticateDevice(ctx.deps, res.token);
		expect(ctx.store.devices[0]?.lastSeenAt).toEqual(t0);
		ctx.advance(5 * 60_000);
		await authenticateDevice(ctx.deps, res.token);
		expect(ctx.store.devices[0]?.lastSeenAt?.getTime()).toBe(t0.getTime() + 6 * 60_000);
	});
});
