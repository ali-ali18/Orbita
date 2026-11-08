import { beforeEach, describe, expect, it } from "vitest";
import { contractSuites } from "./contract-harness.ts";
import type { Stores } from "./stores.ts";

const T0 = new Date("2026-11-07T12:00:00Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);
const DAY = 24 * 60;

describe.each(contractSuites())("IdempotencyStore (%s)", (_name, make) => {
	let stores: Stores;
	let idem: Stores["idempotency"];
	let deviceId: string;
	let otherDeviceId: string;

	async function pairDevice(codeHash: string, at: Date): Promise<string> {
		await stores.auth.replaceActivePairingCode({ codeHash, expiresAt: minutes(10), now: at });
		const code = await stores.auth.findActivePairingCode(at, 5);
		const device = await stores.auth.consumePairingCode({
			codeId: code?.id ?? "",
			now: at,
			deviceName: "Teste",
			tokenHash: `t-${Math.random()}`,
		});
		return device?.id ?? "";
	}

	beforeEach(async () => {
		stores = await make();
		idem = stores.idempotency;
		// A chave aponta para um aparelho de verdade (chave estrangeira no Postgres).
		deviceId = await pairDevice("c1", T0);
		otherDeviceId = await pairDevice("c2", minutes(1));
	});

	const begin = (key: string, now: Date, o: { device?: string; hash?: string; staleAfter?: number } = {}) =>
		idem.begin({
			key,
			deviceId: o.device ?? deviceId,
			requestHash: o.hash ?? "h1",
			now,
			expiresAt: new Date(now.getTime() + DAY * 60_000),
			staleBefore: new Date(now.getTime() - (o.staleAfter ?? 60) * 1000),
		});

	it("a primeira vez reserva; a segunda vê a reserva em andamento", async () => {
		expect(await begin("k1", T0)).toEqual({ outcome: "started" });
		const second = await begin("k1", minutes(1));
		expect(second.outcome).toBe("existing");
		if (second.outcome === "existing") {
			expect(second.record).toMatchObject({
				key: "k1",
				deviceId,
				requestHash: "h1",
				status: null,
				body: null,
			});
		}
	});

	it("complete guarda a resposta e ela volta nas chamadas seguintes", async () => {
		await begin("k1", T0);
		await idem.complete({ key: "k1", deviceId, status: 201, body: '{"ok":true}' });
		const again = await begin("k1", minutes(5), { hash: "outro" });
		expect(again.outcome).toBe("existing");
		if (again.outcome === "existing") {
			expect(again.record).toMatchObject({ status: 201, body: '{"ok":true}', requestHash: "h1" });
		}
	});

	it("release libera a reserva sem resposta, mas não apaga uma resposta guardada", async () => {
		await begin("k1", T0);
		await idem.release({ key: "k1", deviceId });
		expect(await begin("k1", minutes(1))).toEqual({ outcome: "started" });
		await idem.complete({ key: "k1", deviceId, status: 201, body: "{}" });
		await idem.release({ key: "k1", deviceId });
		expect((await begin("k1", minutes(2))).outcome).toBe("existing");
	});

	it("a chave vale por aparelho", async () => {
		await begin("k1", T0);
		expect(await begin("k1", T0, { device: otherDeviceId })).toEqual({ outcome: "started" });
	});

	it("reserva sem resposta e velha (processo caiu) é retomada; a recente, não", async () => {
		await begin("k1", T0);
		expect((await begin("k1", new Date(T0.getTime() + 30_000))).outcome).toBe("existing");
		expect(await begin("k1", new Date(T0.getTime() + 61_000))).toEqual({ outcome: "started" });
	});

	it("reserva com resposta nunca é retomada por ser velha, só ao expirar", async () => {
		await begin("k1", T0);
		await idem.complete({ key: "k1", deviceId, status: 201, body: "{}" });
		expect((await begin("k1", minutes(DAY - 1))).outcome).toBe("existing");
		expect(await begin("k1", minutes(DAY), { hash: "h2" })).toEqual({ outcome: "started" });
		const after = await begin("k1", minutes(DAY + 1));
		expect(after.outcome === "existing" && after.record.status).toBeNull();
	});

	it("pedidos simultâneos com a mesma chave: só um começa", async () => {
		const results = await Promise.all(Array.from({ length: 8 }, () => begin("k1", T0)));
		expect(results.filter((r) => r.outcome === "started")).toHaveLength(1);
		expect(results.filter((r) => r.outcome === "existing")).toHaveLength(7);
	});

	it("retomadas simultâneas de uma reserva velha: só uma ganha", async () => {
		await begin("k1", T0);
		const later = minutes(10);
		const results = await Promise.all(Array.from({ length: 8 }, () => begin("k1", later)));
		expect(results.filter((r) => r.outcome === "started")).toHaveLength(1);
	});

	it("deleteExpired apaga só as que expiraram antes do limite", async () => {
		await begin("velha", T0);
		await begin("nova", minutes(DAY));
		await idem.complete({ key: "nova", deviceId, status: 201, body: "{}" });
		expect(await idem.deleteExpired(minutes(DAY + 1))).toBe(1);
		expect(await idem.deleteExpired(minutes(DAY + 1))).toBe(0);
		expect((await begin("nova", minutes(DAY + 2))).outcome).toBe("existing");
		expect(await begin("velha", minutes(DAY + 2))).toEqual({ outcome: "started" });
	});
});
