import { beforeEach, describe, expect, it } from "vitest";
import { contractSuites } from "./contract-harness.ts";
import type { Stores } from "./stores.ts";

const ITEM = "123e4567-e89b-42d3-a456-426614174000";
const OTHER = "9f8e7d6c-5b4a-4321-8fed-cba987654321";

describe.each(contractSuites())("PluggyConnectionStore (%s)", (_name, make) => {
	let stores: Stores;
	beforeEach(async () => {
		stores = await make();
	});

	it("cadastra com id em minúsculo e lista por ordem de criação", async () => {
		const a = await stores.pluggyConnections.add({ id: ITEM.toUpperCase(), label: "  Nubank  " });
		const b = await stores.pluggyConnections.add({ id: OTHER });
		expect(a).toMatchObject({
			id: ITEM,
			label: "Nubank",
			lastSyncAt: null,
			lastStatus: null,
			lastError: null,
		});
		expect(b.label).toBeNull();
		expect(await stores.pluggyConnections.get(ITEM)).toEqual(a);
		expect((await stores.pluggyConnections.list()).map((c) => c.id)).toEqual([ITEM, OTHER]);
	});

	it("não cadastra a mesma conexão duas vezes", async () => {
		await stores.pluggyConnections.add({ id: ITEM });
		await expect(stores.pluggyConnections.add({ id: ITEM.toUpperCase() })).rejects.toMatchObject({
			name: "DataError",
			code: "duplicate",
			message: "Esta conexão do Meu Pluggy já está cadastrada.",
		});
	});

	it("rejeita id que não é UUID e nome inválido", async () => {
		await expect(stores.pluggyConnections.add({ id: "abc" })).rejects.toMatchObject({ code: "invalid" });
		await expect(stores.pluggyConnections.add({ id: ITEM, label: "  " })).rejects.toMatchObject({
			code: "invalid",
			message: "Informe um nome.",
		});
		await expect(stores.pluggyConnections.add({ id: ITEM, label: "x".repeat(61) })).rejects.toMatchObject({
			code: "invalid",
		});
	});

	it("remove e informa se existia", async () => {
		await stores.pluggyConnections.add({ id: ITEM });
		expect(await stores.pluggyConnections.remove(ITEM)).toBe(true);
		expect(await stores.pluggyConnections.remove(ITEM)).toBe(false);
		expect(await stores.pluggyConnections.get(ITEM)).toBeNull();
	});

	it("registra o resultado: só 'ok' avança lastSyncAt", async () => {
		await stores.pluggyConnections.add({ id: ITEM });
		const at = new Date("2026-11-07T09:00:00Z");
		const ok = await stores.pluggyConnections.recordSync(ITEM, { status: "ok", syncedAt: at });
		expect(ok).toMatchObject({ lastStatus: "ok", lastError: null, lastSyncAt: at });

		const failed = await stores.pluggyConnections.recordSync(ITEM, {
			status: "error",
			error: "  O banco pediu para reconectar.  ",
			syncedAt: new Date("2026-11-08T09:00:00Z"),
		});
		expect(failed).toMatchObject({
			lastStatus: "error",
			lastError: "O banco pediu para reconectar.",
			lastSyncAt: at,
		});

		const noKeys = await stores.pluggyConnections.recordSync(ITEM, { status: "no_keys" });
		expect(noKeys).toMatchObject({ lastStatus: "no_keys", lastError: null, lastSyncAt: at });
	});

	it("corta mensagem de erro comprida e devolve null para conexão que sumiu", async () => {
		await stores.pluggyConnections.add({ id: ITEM });
		const res = await stores.pluggyConnections.recordSync(ITEM, { status: "error", error: "e".repeat(900) });
		expect(res?.lastError).toHaveLength(500);
		expect(await stores.pluggyConnections.recordSync(OTHER, { status: "ok" })).toBeNull();
	});
});
