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

	it("renomear marca como do dono e o nome automático não o sobrescreve", async () => {
		await stores.pluggyConnections.add({ id: ITEM, label: "MeuPluggy" });
		expect(await stores.pluggyConnections.setAutoLabel(ITEM, "Conta Inter")).toBe(true);
		expect(await stores.pluggyConnections.get(ITEM)).toMatchObject({
			label: "Conta Inter",
			labelEditedByOwner: false,
		});
		const renamed = await stores.pluggyConnections.rename(ITEM.toUpperCase(), "  Inter  ");
		expect(renamed).toMatchObject({ label: "Inter", labelEditedByOwner: true });
		expect(await stores.pluggyConnections.setAutoLabel(ITEM, "Outro")).toBe(false);
		expect((await stores.pluggyConnections.get(ITEM))?.label).toBe("Inter");
		await expect(stores.pluggyConnections.rename(ITEM, " ")).rejects.toMatchObject({ code: "invalid" });
		await expect(stores.pluggyConnections.rename(ITEM, "a\nb")).rejects.toMatchObject({ code: "invalid" });
		expect(await stores.pluggyConnections.rename(OTHER, "X")).toBeNull();
		expect(await stores.pluggyConnections.setAutoLabel(OTHER, "X")).toBe(false);
	});

	it("nome dado ao cadastrar por um dono já nasce protegido", async () => {
		const owned = await stores.pluggyConnections.add({ id: ITEM, label: "Meu", byOwner: true });
		expect(owned.labelEditedByOwner).toBe(true);
		const suggested = await stores.pluggyConnections.add({ id: OTHER, label: "Nubank" });
		expect(suggested.labelEditedByOwner).toBe(false);
		expect(await stores.pluggyConnections.setAutoLabel(ITEM, "Outro")).toBe(false);
	});

	it("guarda quantas contas e cartões a sincronização ligou; sem contagem não mexe", async () => {
		await stores.pluggyConnections.add({ id: ITEM });
		expect(await stores.pluggyConnections.get(ITEM)).toMatchObject({ accountCount: 0, cardCount: 0 });
		const at = new Date("2026-11-07T09:00:00Z");
		await stores.pluggyConnections.recordSync(ITEM, {
			status: "ok",
			syncedAt: at,
			counts: { accounts: 1, cards: 1 },
		});
		expect(await stores.pluggyConnections.get(ITEM)).toMatchObject({ accountCount: 1, cardCount: 1 });
		await stores.pluggyConnections.recordSync(ITEM, { status: "error", error: "x" });
		expect(await stores.pluggyConnections.get(ITEM)).toMatchObject({ accountCount: 1, cardCount: 1 });
		await expect(
			stores.pluggyConnections.recordSync(ITEM, { status: "ok", counts: { accounts: -1, cards: 0 } }),
		).rejects.toMatchObject({ code: "invalid" });
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

	it("historyFrom guarda o dia mais antigo já buscado, só com sincronização ok, e nunca encurta", async () => {
		await stores.pluggyConnections.add({ id: ITEM });
		expect(await stores.pluggyConnections.get(ITEM)).toMatchObject({ historyFrom: null });
		const at = new Date("2026-11-07T09:00:00Z");
		await stores.pluggyConnections.recordSync(ITEM, { status: "partial", historyFrom: "2026-05-08" });
		expect(await stores.pluggyConnections.get(ITEM)).toMatchObject({ historyFrom: null });
		await stores.pluggyConnections.recordSync(ITEM, {
			status: "ok",
			syncedAt: at,
			historyFrom: "2026-07-10",
		});
		expect(await stores.pluggyConnections.get(ITEM)).toMatchObject({ historyFrom: "2026-07-10" });
		await stores.pluggyConnections.recordSync(ITEM, {
			status: "ok",
			syncedAt: at,
			historyFrom: "2026-05-08",
		});
		expect(await stores.pluggyConnections.get(ITEM)).toMatchObject({ historyFrom: "2026-05-08" });
		await stores.pluggyConnections.recordSync(ITEM, {
			status: "ok",
			syncedAt: at,
			historyFrom: "2026-07-10",
		});
		expect(await stores.pluggyConnections.get(ITEM)).toMatchObject({ historyFrom: "2026-05-08" });
		await stores.pluggyConnections.recordSync(ITEM, { status: "ok", syncedAt: at });
		expect(await stores.pluggyConnections.get(ITEM)).toMatchObject({ historyFrom: "2026-05-08" });
	});

	it("corta mensagem de erro comprida e devolve null para conexão que sumiu", async () => {
		await stores.pluggyConnections.add({ id: ITEM });
		const res = await stores.pluggyConnections.recordSync(ITEM, { status: "error", error: "e".repeat(900) });
		expect(res?.lastError).toHaveLength(500);
		expect(await stores.pluggyConnections.recordSync(OTHER, { status: "ok" })).toBeNull();
	});

	it("resetSyncWindow zera a última sincronização de todas e mantém o resto", async () => {
		await stores.pluggyConnections.add({ id: ITEM, label: "Nubank" });
		await stores.pluggyConnections.add({ id: OTHER });
		const at = new Date("2026-11-06T09:00:00Z");
		await stores.pluggyConnections.recordSync(ITEM, {
			status: "ok",
			syncedAt: at,
			counts: { accounts: 1, cards: 1 },
		});
		await stores.pluggyConnections.recordSync(OTHER, { status: "ok", syncedAt: at });
		expect(await stores.pluggyConnections.resetSyncWindow()).toBe(2);
		const [a, b] = await stores.pluggyConnections.list();
		expect(a).toMatchObject({ id: ITEM, label: "Nubank", lastSyncAt: null, lastStatus: "ok", cardCount: 1 });
		expect(b?.lastSyncAt).toBeNull();
	});

	it("resetSyncWindow sem conexões devolve 0", async () => {
		expect(await stores.pluggyConnections.resetSyncWindow()).toBe(0);
	});
});
