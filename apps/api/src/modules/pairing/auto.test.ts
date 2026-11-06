import { createMemoryAuthStore } from "@orbita/db";
import { deriveKey } from "@orbita/security";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensurePairingCode, formatPairingBanner, startAutoPairing } from "./auto.ts";
import { createPairingGuard, PAIRING_FAILED_CLAIMS_LIMIT } from "./guard.ts";
import { PAIRING_CODE_TTL_MS, type PairingDeps } from "./service.ts";

const t0 = new Date("2026-11-06T12:00:00Z");

function setup() {
	const store = createMemoryAuthStore();
	let now = t0;
	const deps: PairingDeps = { store, pairingKey: deriveKey("s".repeat(48), "pairing-code"), now: () => now };
	const log = { info: vi.fn<(m: string) => void>(), error: vi.fn<(m: string, e?: unknown) => void>() };
	const guard = createPairingGuard(() => now.getTime());
	return { store, deps, guard, log, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

describe("ensurePairingCode", () => {
	it("cria um código quando não há aparelho nem código ativo", async () => {
		const { deps, store } = setup();
		const created = await ensurePairingCode(deps);
		expect(created?.code).toMatch(/^\d{6}$/);
		expect(store.codes).toHaveLength(1);
	});

	it("não faz nada enquanto há código ativo", async () => {
		const { deps, store } = setup();
		await ensurePairingCode(deps);
		expect(await ensurePairingCode(deps)).toBeNull();
		expect(store.codes).toHaveLength(1);
	});

	it("cria outro depois que o anterior expira", async () => {
		const { deps, store, advance } = setup();
		await ensurePairingCode(deps);
		advance(PAIRING_CODE_TTL_MS);
		expect(await ensurePairingCode(deps)).not.toBeNull();
		expect(store.codes).toHaveLength(2);
	});

	it("não cria código se já existe aparelho conectado", async () => {
		const { deps, store, advance } = setup();
		const first = await store.replaceActivePairingCode({
			codeHash: "a",
			expiresAt: new Date(t0.getTime() + 1000),
			now: t0,
		});
		await store.consumePairingCode({ codeId: first.id, now: t0, deviceName: "Galaxy", tokenHash: "t" });
		advance(PAIRING_CODE_TTL_MS);
		expect(await ensurePairingCode(deps)).toBeNull();
	});
});

describe("formatPairingBanner", () => {
	it("mostra o código com espaço, a hora de Brasília e a instrução", () => {
		const banner = formatPairingBanner("482913", new Date("2026-11-06T15:10:00Z"));
		expect(banner).toContain("482 913");
		expect(banner).toContain("12:10");
		expect(banner).toContain("Digite este código no app. Se ninguém conectar em 10 minutos, eu gero outro.");
	});
});

describe("startAutoPairing", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("loga o banner na hora, não repete enquanto vale e gera outro após expirar", async () => {
		const { deps, guard, log, advance } = setup();
		const stop = startAutoPairing({ deps, guard, log, intervalMs: 30_000 });
		await vi.advanceTimersByTimeAsync(0);
		expect(log.info).toHaveBeenCalledTimes(1);

		advance(30_000);
		await vi.advanceTimersByTimeAsync(30_000);
		expect(log.info).toHaveBeenCalledTimes(1);

		advance(PAIRING_CODE_TTL_MS);
		await vi.advanceTimersByTimeAsync(30_000);
		expect(log.info).toHaveBeenCalledTimes(2);
		stop();
	});

	it("para de gerar códigos quando um aparelho conecta", async () => {
		const { deps, store, guard, log, advance } = setup();
		const stop = startAutoPairing({ deps, guard, log, intervalMs: 30_000 });
		await vi.advanceTimersByTimeAsync(0);
		const active = await store.findActivePairingCode(t0, 5);
		await store.consumePairingCode({
			codeId: active?.id ?? "",
			now: t0,
			deviceName: "Galaxy",
			tokenHash: "t",
		});

		advance(PAIRING_CODE_TTL_MS);
		await vi.advanceTimersByTimeAsync(PAIRING_CODE_TTL_MS);
		expect(log.info).toHaveBeenCalledTimes(1);
		stop();
	});

	it("loga o erro e continua rodando", async () => {
		const { deps, guard, log } = setup();
		deps.store.countActiveDevices = async () => {
			throw new Error("banco fora");
		};
		const stop = startAutoPairing({ deps, guard, log, intervalMs: 30_000 });
		await vi.advanceTimersByTimeAsync(60_000);
		expect(log.error).toHaveBeenCalledTimes(3);
		stop();
	});

	it("stop() encerra o laço", async () => {
		const { deps, guard, log, advance } = setup();
		const stop = startAutoPairing({ deps, guard, log, intervalMs: 30_000 });
		await vi.advanceTimersByTimeAsync(0);
		stop();
		advance(PAIRING_CODE_TTL_MS);
		await vi.advanceTimersByTimeAsync(120_000);
		expect(log.info).toHaveBeenCalledTimes(1);
	});

	it("não gera código enquanto os palpites errados estão pausados, e retoma quando a janela vira", async () => {
		const { deps, store, guard, log, advance } = setup();
		for (let i = 0; i < PAIRING_FAILED_CLAIMS_LIMIT; i++) guard.recordFailure();
		const stop = startAutoPairing({ deps, guard, log, intervalMs: 30_000 });
		await vi.advanceTimersByTimeAsync(0);
		expect(store.codes).toHaveLength(0);
		expect(log.info).toHaveBeenCalledTimes(1);
		expect(log.info.mock.calls[0]?.[0]).toContain("pausado");

		// Continua pausado: nada de código novo e nada de repetir o aviso.
		advance(30_000);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(store.codes).toHaveLength(0);
		expect(log.info).toHaveBeenCalledTimes(1);

		advance(60 * 60_000);
		await vi.advanceTimersByTimeAsync(30_000);
		expect(store.codes).toHaveLength(1);
		expect(log.info).toHaveBeenCalledTimes(2);
		stop();
	});
});
