import { createMemoryStores } from "@orbita/db";
import { describe, expect, it } from "vitest";
import { type Json, NOW, setupFinance } from "../../test-support.ts";
import type { PluggyQueueState, PluggySyncQueue } from "./queue.ts";

const ITEM = "123e4567-e89b-42d3-a456-426614174000";
const OTHER = "9f8e7d6c-5b4a-4321-8fed-cba987654321";
const CLIENT_ID = "aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb";
const CLIENT_SECRET = "cccccccc-2222-4333-8444-dddddddddddd";
const API_KEY = "eyJhbGciOiJIUzI1NiJ9.fake-api-key-payload.fake-signature";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** Pluggy falso: só conhece o ITEM. */
function pluggyFetch(calls: string[] = []) {
	return async (url: string, init: RequestInit): Promise<Response> => {
		const u = new URL(url);
		calls.push(`${init.method} ${u.host}${u.pathname}`);
		if (u.pathname === "/auth") return json({ apiKey: API_KEY });
		if (u.pathname === `/items/${ITEM}`) {
			return json({ id: ITEM, status: "UPDATED", connector: { name: "Nubank" } });
		}
		return json({ message: `não achei ${CLIENT_SECRET}` }, 404);
	};
}

function fakeQueue() {
	const calls: string[] = [];
	let state: PluggyQueueState = "idle";
	const queue: PluggySyncQueue = {
		async enqueue() {
			calls.push("enqueue");
			state = state === "running" ? "running" : "queued";
			return state;
		},
		async state() {
			return state;
		},
		async close() {},
	};
	return { queue, calls, set: (s: PluggyQueueState) => (state = s) };
}

async function withKeys(api: { put: (p: string, b: unknown) => Promise<{ status: number }> }) {
	await api.put("/v1/settings/secrets/pluggy_client_id", { value: CLIENT_ID });
	await api.put("/v1/settings/secrets/pluggy_client_secret", { value: CLIENT_SECRET });
}

const make = async (calls: string[] = []) => {
	const q = fakeQueue();
	const t = await setupFinance(NOW, undefined, { pluggySyncQueue: q.queue, pluggyFetch: pluggyFetch(calls) });
	return { ...t, q };
};

describe("rotas do Meu Pluggy: autenticação", () => {
	it("sem token tudo dá 401", async () => {
		const { call } = await make();
		for (const [method, path, body] of [
			["GET", "/v1/pluggy/connections", undefined],
			["POST", "/v1/pluggy/connections", { itemId: ITEM }],
			["PATCH", `/v1/pluggy/connections/${ITEM}`, { label: "Inter" }],
			["DELETE", `/v1/pluggy/connections/${ITEM}`, undefined],
			["POST", "/v1/pluggy/sync", {}],
			["POST", "/v1/pluggy/reimport", {}],
			["GET", "/v1/pluggy/status", undefined],
		] as const) {
			expect((await call(method, path, body, null)).status, `${method} ${path}`).toBe(401);
		}
	});
});

describe("conexões", () => {
	it("cadastra, lista e remove", async () => {
		const { api } = await make();
		expect((await api.get("/v1/pluggy/connections")).body).toEqual({ connections: [] });
		const created = await api.post("/v1/pluggy/connections", {
			itemId: ITEM.toUpperCase(),
			label: "  Nubank PF ",
		});
		expect(created.status).toBe(201);
		expect(created.body.connection).toEqual({
			id: ITEM,
			label: "Nubank PF",
			createdAt: expect.any(String),
			lastSyncAt: null,
			lastStatus: null,
			lastError: null,
			summary: { accounts: 0, cards: 0 },
		});
		expect((await api.get("/v1/pluggy/connections")).body.connections).toHaveLength(1);
		const removed = await api.delete(`/v1/pluggy/connections/${ITEM}`);
		expect(removed.status).toBe(200);
		expect(removed.body.connection.id).toBe(ITEM);
		expect((await api.delete(`/v1/pluggy/connections/${ITEM}`)).status).toBe(404);
		expect((await api.get("/v1/pluggy/connections")).body.connections).toEqual([]);
	});

	it("valida o corpo: UUID, nome, campos extras", async () => {
		const { api } = await make();
		for (const body of [
			{},
			{ itemId: "nao-e-uuid" },
			{ itemId: 12 },
			{ itemId: ITEM, label: "" },
			{ itemId: ITEM, label: "x".repeat(61) },
			{ itemId: ITEM, userId: "outro" },
		]) {
			const res = await api.post("/v1/pluggy/connections", body);
			expect(res.status, JSON.stringify(body)).toBe(400);
			expect(res.body.error.code).toBe("dados_invalidos");
		}
		expect((await api.delete("/v1/pluggy/connections/abc")).status).toBe(400);
	});

	it("renomeia: aparar, validar, 404 e marca como do dono", async () => {
		const { api, stores } = await make();
		await api.post("/v1/pluggy/connections", { itemId: ITEM });
		const res = await api.patch(`/v1/pluggy/connections/${ITEM.toUpperCase()}`, {
			label: "  Inter + Mercado Pago ",
		});
		expect(res.status).toBe(200);
		expect(res.body.connection).toMatchObject({ id: ITEM, label: "Inter + Mercado Pago" });
		expect((await stores.pluggyConnections.get(ITEM))?.labelEditedByOwner).toBe(true);
		expect((await api.get("/v1/pluggy/connections")).body.connections[0].label).toBe("Inter + Mercado Pago");

		for (const body of [
			{},
			{ label: "" },
			{ label: "   " },
			{ label: "x".repeat(61) },
			{ label: "linha\nquebrada" },
			{ label: "invisi\u200bvel" },
			{ label: 12 },
			{ label: "Ok", itemId: OTHER },
		]) {
			const bad = await api.patch(`/v1/pluggy/connections/${ITEM}`, body);
			expect(bad.status, JSON.stringify(body)).toBe(400);
			expect(bad.body.error.code).toBe("dados_invalidos");
		}
		expect((await api.patch("/v1/pluggy/connections/abc", { label: "A" })).status).toBe(400);
		const missing = await api.patch(`/v1/pluggy/connections/${OTHER}`, { label: "A" });
		expect(missing.status).toBe(404);
		expect((await api.get("/v1/pluggy/connections")).body.connections[0].label).toBe("Inter + Mercado Pago");
	});

	it("nome digitado ao cadastrar é do dono; o sugerido pelo Pluggy não", async () => {
		const { api, stores } = await make();
		await withKeys(api);
		await api.post("/v1/pluggy/connections", { itemId: ITEM });
		expect((await stores.pluggyConnections.get(ITEM))?.labelEditedByOwner).toBe(false);
		await stores.pluggyConnections.remove(ITEM);
		await api.post("/v1/pluggy/connections", { itemId: ITEM, label: "Meu nome" });
		expect((await stores.pluggyConnections.get(ITEM))?.labelEditedByOwner).toBe(true);
	});

	it("a mesma conexão duas vezes dá 409", async () => {
		const { api } = await make();
		await api.post("/v1/pluggy/connections", { itemId: ITEM });
		const again = await api.post("/v1/pluggy/connections", { itemId: ITEM });
		expect(again.status).toBe(409);
	});

	it("sem chaves cadastra sem conferir no Pluggy", async () => {
		const calls: string[] = [];
		const { api } = await make(calls);
		const res = await api.post("/v1/pluggy/connections", { itemId: OTHER });
		expect(res.status).toBe(201);
		expect(res.body.connection.label).toBeNull();
		expect(calls).toEqual([]);
	});

	it("com chaves, confere no Pluggy (só api.pluggy.ai) e usa o nome do banco", async () => {
		const calls: string[] = [];
		const { api } = await make(calls);
		await withKeys(api);
		const res = await api.post("/v1/pluggy/connections", { itemId: ITEM });
		expect(res.status).toBe(201);
		expect(res.body.connection.label).toBe("Nubank");
		expect(calls).toEqual(["POST api.pluggy.ai/auth", `GET api.pluggy.ai/items/${ITEM}`]);
	});

	it("com chaves, ID que o Pluggy não conhece é recusado (422) sem repetir o corpo do Pluggy", async () => {
		const { api } = await make();
		await withKeys(api);
		const res = await api.post("/v1/pluggy/connections", { itemId: OTHER });
		expect(res.status).toBe(422);
		expect(res.body.error.code).toBe("conexao_invalida");
		expect(JSON.stringify(res.body)).not.toContain(CLIENT_SECRET);
		expect((await api.get("/v1/pluggy/connections")).body.connections).toEqual([]);
	});

	it("falha passageira do Pluggy não impede o cadastro", async () => {
		const q = fakeQueue();
		const t = await setupFinance(NOW, undefined, {
			pluggySyncQueue: q.queue,
			pluggyFetch: async () => json({}, 503),
		});
		await withKeys(t.api);
		const res = await t.api.post("/v1/pluggy/connections", { itemId: ITEM });
		expect(res.status).toBe(201);
	});
});

describe("sincronizar agora", () => {
	it("sem conexões ou sem chaves recusa com motivo", async () => {
		const { api, q } = await make();
		const noConn = await api.post("/v1/pluggy/sync");
		expect(noConn.status).toBe(400);
		expect(noConn.body.error.code).toBe("sem_conexoes");

		await api.post("/v1/pluggy/connections", { itemId: ITEM });
		const noKeys = await api.post("/v1/pluggy/sync");
		expect(noKeys.status).toBe(400);
		expect(noKeys.body.error.code).toBe("sem_chaves");
		expect(q.calls).toEqual([]);
	});

	it("enfileira (202) e pedido repetido continua 'queued'", async () => {
		const { api, q } = await make();
		await withKeys(api);
		await api.post("/v1/pluggy/connections", { itemId: ITEM });
		const first = await api.post("/v1/pluggy/sync");
		expect(first.status).toBe(202);
		expect(first.body).toEqual({ sync: "queued" });
		q.set("running");
		expect((await api.post("/v1/pluggy/sync")).body).toEqual({ sync: "running" });
		expect(q.calls).toEqual(["enqueue", "enqueue"]);
	});

	it("sem fila (sem Redis) responde 503", async () => {
		const { api } = await setupFinance();
		const res = await api.post("/v1/pluggy/sync");
		expect(res.status).toBe(503);
		expect(res.body.error.code).toBe("fila_indisponivel");
	});
});

describe("reimportar do zero", () => {
	async function withData() {
		const stores = createMemoryStores({ now: () => new Date(NOW) });
		const q = fakeQueue();
		const t = await setupFinance(NOW, () => stores, { pluggySyncQueue: q.queue, pluggyFetch: pluggyFetch() });
		await withKeys(t.api);
		await t.api.post("/v1/pluggy/connections", { itemId: ITEM });
		const account = await stores.accounts.create({
			name: "Conta",
			kind: "checking",
			source: "pluggy",
			externalId: "a1",
		});
		await stores.pluggyConnections.recordSync(ITEM, {
			status: "ok",
			syncedAt: new Date("2026-11-10T09:00:00Z"),
		});
		const base = { kind: "expense" as const, amountCents: 1000, date: "2026-11-05", accountId: account.id };
		const manual = await stores.transactions.create({ ...base, description: "Manual" });
		await stores.transactions.upsertByExternal("pluggy", "p1", { ...base, description: "Do Pluggy" });
		await stores.transactions.upsertByExternal("pluggy", "p2", { ...base, description: "Outro" });
		return { ...t, q, stores, account, manual };
	}

	it("apaga só o que veio do Pluggy, zera a janela e enfileira; manuais, contas e cartões ficam", async () => {
		const { api, q, stores, manual, account } = await withData();
		const res = await api.post("/v1/pluggy/reimport");
		expect(res.status).toBe(202);
		expect(res.body).toEqual({ deleted: 2, sync: "queued" });
		expect(q.calls).toEqual(["enqueue"]);
		expect((await stores.transactions.listRecent({ limit: 10 })).map((t) => t.id)).toEqual([manual.id]);
		expect(await stores.transactions.existsByExternal("pluggy", "p1")).toBe(false);
		expect((await stores.pluggyConnections.get(ITEM))?.lastSyncAt).toBeNull();
		expect(await stores.accounts.findByExternal("pluggy", "a1")).toMatchObject({ id: account.id });
	});

	it("recusa antes de apagar: sem fila, sem conexões, sem chaves ou com sincronização rodando", async () => {
		const { api, q, stores } = await withData();
		q.set("running");
		const busy = await api.post("/v1/pluggy/reimport");
		expect(busy.status).toBe(409);
		expect(busy.body.error.code).toBe("sincronizando");
		expect(await stores.transactions.existsByExternal("pluggy", "p1")).toBe(true);
		expect((await stores.pluggyConnections.get(ITEM))?.lastSyncAt).not.toBeNull();

		const none = await make();
		expect((await none.api.post("/v1/pluggy/reimport")).body.error.code).toBe("sem_conexoes");
		await none.api.post("/v1/pluggy/connections", { itemId: ITEM });
		expect((await none.api.post("/v1/pluggy/reimport")).body.error.code).toBe("sem_chaves");

		const noQueue = await setupFinance();
		expect((await noQueue.api.post("/v1/pluggy/reimport")).status).toBe(503);
	});
});

describe("status", () => {
	it("mostra chaves, fila e resultado de cada conexão, sem nenhum segredo", async () => {
		const { api, stores, q } = await make();
		expect((await api.get("/v1/pluggy/status")).body).toEqual({
			keysConfigured: false,
			sync: "idle",
			lastSyncAt: null,
			connections: [],
		});

		await withKeys(api);
		await api.post("/v1/pluggy/connections", { itemId: ITEM });
		await stores.pluggyConnections.recordSync(ITEM, {
			status: "ok",
			syncedAt: new Date("2026-11-07T09:00:00Z"),
		});
		await stores.pluggyConnections.add({ id: OTHER });
		await stores.pluggyConnections.recordSync(OTHER, {
			status: "error",
			error: "O banco pediu para reconectar.",
		});
		q.set("queued");

		const res = await api.get("/v1/pluggy/status");
		expect(res.status).toBe(200);
		const body = res.body as Json;
		expect(body.keysConfigured).toBe(true);
		expect(body.sync).toBe("queued");
		expect(body.lastSyncAt).toBeNull(); // uma das conexões nunca sincronizou
		expect(body.connections.map((c: Json) => [c.lastStatus, c.lastError])).toEqual([
			["ok", null],
			["error", "O banco pediu para reconectar."],
		]);
		const text = JSON.stringify(body);
		for (const secret of [CLIENT_ID, CLIENT_SECRET, API_KEY]) expect(text).not.toContain(secret);
	});

	it("lastSyncAt é a sincronização mais antiga quando todas já rodaram; sem fila vira 'unavailable'", async () => {
		const { api, stores } = await make();
		await stores.pluggyConnections.add({ id: ITEM });
		await stores.pluggyConnections.add({ id: OTHER });
		await stores.pluggyConnections.recordSync(ITEM, {
			status: "ok",
			syncedAt: new Date("2026-11-07T09:00:00Z"),
		});
		await stores.pluggyConnections.recordSync(OTHER, {
			status: "ok",
			syncedAt: new Date("2026-11-06T09:00:00Z"),
		});
		expect((await api.get("/v1/pluggy/status")).body.lastSyncAt).toBe("2026-11-06T09:00:00.000Z");

		const noQueue = await setupFinance();
		expect((await noQueue.api.get("/v1/pluggy/status")).body.sync).toBe("unavailable");
	});

	it("chaves que não abrem (APP_SECRET trocado) contam como não configuradas", async () => {
		const { api, stores } = await make();
		await stores.secrets.put("pluggy_client_id", "v1.lixo", "x");
		await stores.secrets.put("pluggy_client_secret", "v1.lixo", "x");
		expect((await api.get("/v1/pluggy/status")).body.keysConfigured).toBe(false);
	});
});
