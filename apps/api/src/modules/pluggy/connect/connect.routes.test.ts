import { describe, expect, it } from "vitest";
import { NOW, setupFinance } from "../../../test-support.ts";
import type { PluggyQueueState, PluggySyncQueue } from "../queue.ts";
import { buildConnectAsset } from "./assets.ts";
import { createConnectSession, hashConnectToken } from "./session.ts";

const ITEM = "123e4567-e89b-42d3-a456-426614174000";
const FOREIGN = "9f8e7d6c-5b4a-4321-8fed-cba987654321";
const CLIENT_ID = "aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb";
const CLIENT_SECRET = "cccccccc-2222-4333-8444-dddddddddddd";
const API_KEY = "eyJhbGciOiJIUzI1NiJ9.fake-api-key-payload.fake-signature";
const CONNECT_TOKEN = "eyJhbGciOiJIUzI1NiJ9.fake-connect-token.fake-signature";
const ASSET = { path: "/pluggy/conectar/app.abcd1234.js", code: new TextEncoder().encode("/*widget*/") };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** Pluggy falso: só conhece o ITEM; o FOREIGN é de outra aplicação (404). */
function pluggyFetch(log: { path: string; body: string }[] = [], failItems = false) {
	return async (url: string, init: RequestInit): Promise<Response> => {
		const u = new URL(url);
		log.push({ path: `${init.method} ${u.pathname}`, body: String(init.body ?? "") });
		if (u.pathname === "/auth") return json({ apiKey: API_KEY });
		if (u.pathname === "/connect_token") return json({ accessToken: CONNECT_TOKEN });
		if (failItems) return json({ message: `erro com ${CLIENT_SECRET}` }, 503);
		if (u.pathname === `/items/${ITEM}`) {
			return json({ id: ITEM, status: "UPDATED", connector: { name: "Nubank" } });
		}
		return json({ message: "Item not found" }, 404);
	};
}

function fakeQueue() {
	let state: PluggyQueueState = "idle";
	const calls: string[] = [];
	const queue: PluggySyncQueue = {
		async enqueue() {
			calls.push("enqueue");
			state = "queued";
			return "queued";
		},
		async state() {
			return state;
		},
		async close() {},
	};
	return { queue, calls };
}

async function make(opts: { keys?: boolean; failItems?: boolean } = {}) {
	const log: { path: string; body: string }[] = [];
	const q = fakeQueue();
	const t = await setupFinance(NOW, undefined, {
		pluggySyncQueue: q.queue,
		pluggyFetch: pluggyFetch(log, opts.failItems),
		pluggyConnectAsset: async () => ASSET,
	});
	if (opts.keys !== false) {
		await t.api.put("/v1/settings/secrets/pluggy_client_id", { value: CLIENT_ID });
		await t.api.put("/v1/settings/secrets/pluggy_client_secret", { value: CLIENT_SECRET });
	}
	const newSession = async () => {
		const res = await t.api.post("/v1/pluggy/connect-sessions");
		expect(res.status).toBe(201);
		return (res.body.path as string).split("#s=")[1] as string;
	};
	const pub = (path: string, body: unknown) => t.call("POST", path, body, null);
	return { ...t, q, log, newSession, pub };
}

describe("criar a sessão (app)", () => {
	it("exige o Bearer do aparelho", async () => {
		const { call } = await make();
		expect((await call("POST", "/v1/pluggy/connect-sessions", {}, null)).status).toBe(401);
	});

	it("sem chaves cadastradas avisa na hora", async () => {
		const { api } = await make({ keys: false });
		const res = await api.post("/v1/pluggy/connect-sessions");
		expect(res.status).toBe(409);
		expect(res.body.error.message).toBe("Cadastre as chaves do Pluggy no app (Servidor e chaves).");
	});

	it("devolve o caminho com o token no fragmento e guarda só o hash", async () => {
		const { api, stores } = await make();
		const res = await api.post("/v1/pluggy/connect-sessions");
		expect(res.body.path).toMatch(/^\/pluggy\/conectar#s=[A-Za-z0-9_-]{43}$/);
		expect(Date.parse(res.body.expiresAt) - Date.parse(NOW)).toBe(15 * 60_000);
		const token = (res.body.path as string).split("#s=")[1] as string;
		const now = new Date(NOW);
		expect(await stores.pluggyConnectSessions.isActive(hashConnectToken(token), now)).toBe(true);
		expect(await stores.pluggyConnectSessions.isActive(token, now)).toBe(false);
	});

	it("uma sessão nova invalida a anterior", async () => {
		const { newSession, pub } = await make();
		const first = await newSession();
		await newSession();
		expect((await pub("/pluggy/connect-token", { session: first })).status).toBe(401);
	});
});

describe("POST /pluggy/connect-token (público)", () => {
	it("sessão válida devolve só o token do widget", async () => {
		const { newSession, pub, log } = await make();
		const session = await newSession();
		const res = await pub("/pluggy/connect-token", { session });
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ connectToken: CONNECT_TOKEN });
		expect(JSON.stringify(res.body)).not.toContain(API_KEY);
		const call = log.find((l) => l.path === "POST /connect_token");
		expect(JSON.parse(call?.body ?? "{}")).toEqual({ options: { clientUserId: "orbita" } });
	});

	it("pode pedir mais de uma vez (a sessão só é gasta ao concluir)", async () => {
		const { newSession, pub } = await make();
		const session = await newSession();
		expect((await pub("/pluggy/connect-token", { session })).status).toBe(200);
		expect((await pub("/pluggy/connect-token", { session })).status).toBe(200);
	});

	it("sessão desconhecida, expirada ou mal formada é recusada com mensagem fixa", async () => {
		const { stores, pub } = await make();
		const old = await createConnectSession(stores.pluggyConnectSessions, new Date("2026-11-15T14:30:00Z"));
		const expired = await pub("/pluggy/connect-token", { session: old.token });
		expect(expired.status).toBe(401);
		expect(expired.body.error.code).toBe("sessao_invalida");
		const unknown = await pub("/pluggy/connect-token", { session: "a".repeat(43) });
		expect(unknown.status).toBe(401);
		expect(unknown.body).toEqual(expired.body);
		for (const body of [{}, { session: "curto" }, { session: 1 }, { session: "a".repeat(43), x: 1 }]) {
			const res = await pub("/pluggy/connect-token", body);
			expect(res.status, JSON.stringify(body)).toBe(400);
			expect(res.body.error.message).toBe("Pedido inválido.");
		}
	});

	it("sem chaves: pede para cadastrar no app", async () => {
		const { vault, newSession, pub } = await make();
		const session = await newSession();
		await vault.remove("pluggy_client_secret");
		const res = await pub("/pluggy/connect-token", { session });
		expect(res.status).toBe(409);
		expect(res.body.error.message).toBe("Cadastre as chaves do Pluggy no app (Servidor e chaves).");
	});

	it("falha do Pluggy vira mensagem fixa, sem o corpo da resposta", async () => {
		const t = await setupFinance(NOW, undefined, {
			pluggyConnectAsset: async () => ASSET,
			pluggyFetch: async (url) =>
				new URL(url).pathname === "/auth" ? json({ apiKey: API_KEY }) : json({ message: CLIENT_SECRET }, 500),
		});
		await t.api.put("/v1/settings/secrets/pluggy_client_id", { value: CLIENT_ID });
		await t.api.put("/v1/settings/secrets/pluggy_client_secret", { value: CLIENT_SECRET });
		const session = ((await t.api.post("/v1/pluggy/connect-sessions")).body.path as string).split("#s=")[1];
		const res = await t.call("POST", "/pluggy/connect-token", { session }, null);
		expect(res.status).toBe(502);
		expect(JSON.stringify(res.body)).not.toContain(CLIENT_SECRET);
	});

	it("limita por IP", async () => {
		const { pub } = await make();
		const statuses: number[] = [];
		for (let i = 0; i < 31; i++) {
			statuses.push((await pub("/pluggy/connect-token", { session: "a".repeat(43) })).status);
		}
		expect(statuses.at(-1)).toBe(429);
		expect(statuses.slice(0, 30).every((s) => s === 401)).toBe(true);
	});

	it("corpo grande demais dá 413", async () => {
		const { pub } = await make();
		const res = await pub("/pluggy/connect-token", { session: "a".repeat(2000) });
		expect(res.status).toBe(413);
	});
});

describe("POST /pluggy/connect-complete (público)", () => {
	it("cadastra a conexão com o nome do banco e enfileira a sincronização", async () => {
		const { newSession, pub, api, q } = await make();
		const session = await newSession();
		const res = await pub("/pluggy/connect-complete", { session, itemId: ITEM.toUpperCase() });
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ connected: true, name: "Nubank", sync: "queued" });
		expect(q.calls).toEqual(["enqueue"]);
		const list = (await api.get("/v1/pluggy/connections")).body.connections;
		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({ id: ITEM, label: "Nubank" });
	});

	it("uso único: a mesma sessão não conclui duas vezes", async () => {
		const { newSession, pub, q } = await make();
		const session = await newSession();
		expect((await pub("/pluggy/connect-complete", { session, itemId: ITEM })).status).toBe(200);
		const again = await pub("/pluggy/connect-complete", { session, itemId: ITEM });
		expect(again.status).toBe(401);
		expect((await pub("/pluggy/connect-token", { session })).status).toBe(401);
		expect(q.calls).toHaveLength(1);
	});

	it("pedidos simultâneos: só um conclui", async () => {
		const { newSession, pub, api } = await make();
		const session = await newSession();
		const results = await Promise.all(
			Array.from({ length: 6 }, () => pub("/pluggy/connect-complete", { session, itemId: ITEM })),
		);
		expect(results.filter((r) => r.status === 200)).toHaveLength(1);
		expect(results.filter((r) => r.status === 401)).toHaveLength(5);
		expect((await api.get("/v1/pluggy/connections")).body.connections).toHaveLength(1);
	});

	it("ID que não é da nossa aplicação é recusado e não gasta a sessão", async () => {
		const { newSession, pub, api, q } = await make();
		const session = await newSession();
		const res = await pub("/pluggy/connect-complete", { session, itemId: FOREIGN });
		expect(res.status).toBe(422);
		expect(res.body.error.code).toBe("conexao_invalida");
		expect((await api.get("/v1/pluggy/connections")).body.connections).toEqual([]);
		expect(q.calls).toEqual([]);
		expect((await pub("/pluggy/connect-complete", { session, itemId: ITEM })).status).toBe(200);
	});

	it("falha passageira do Pluggy não cadastra nem gasta a sessão", async () => {
		const { newSession, pub, api } = await make({ failItems: true });
		const session = await newSession();
		const res = await pub("/pluggy/connect-complete", { session, itemId: ITEM });
		expect(res.status).toBe(502);
		expect(JSON.stringify(res.body)).not.toContain(CLIENT_SECRET);
		expect((await api.get("/v1/pluggy/connections")).body.connections).toEqual([]);
		expect((await pub("/pluggy/connect-token", { session })).status).toBe(200);
	});

	it("é idempotente quando a conexão já existe", async () => {
		const { newSession, pub, api, q } = await make();
		await api.post("/v1/pluggy/connections", { itemId: ITEM, label: "Meu nome" });
		const res = await pub("/pluggy/connect-complete", { session: await newSession(), itemId: ITEM });
		expect(res.status).toBe(200);
		const list = (await api.get("/v1/pluggy/connections")).body.connections;
		expect(list).toHaveLength(1);
		expect(list[0].label).toBe("Meu nome");
		expect(q.calls).toEqual(["enqueue"]);
	});

	it("sem fila (sem Redis) conclui e diz que a sincronização está indisponível", async () => {
		const t = await setupFinance(NOW, undefined, {
			pluggyConnectAsset: async () => ASSET,
			pluggyFetch: pluggyFetch(),
		});
		await t.api.put("/v1/settings/secrets/pluggy_client_id", { value: CLIENT_ID });
		await t.api.put("/v1/settings/secrets/pluggy_client_secret", { value: CLIENT_SECRET });
		const session = ((await t.api.post("/v1/pluggy/connect-sessions")).body.path as string).split("#s=")[1];
		const res = await t.call("POST", "/pluggy/connect-complete", { session, itemId: ITEM }, null);
		expect(res.body).toMatchObject({ connected: true, sync: "unavailable" });
	});

	it("valida o corpo", async () => {
		const { newSession, pub } = await make();
		const session = await newSession();
		for (const body of [
			{ session },
			{ session, itemId: "nao-e-uuid" },
			{ session, itemId: ITEM, extra: 1 },
			{ itemId: ITEM },
		]) {
			expect((await pub("/pluggy/connect-complete", body)).status, JSON.stringify(body)).toBe(400);
		}
	});
});

describe("página e cabeçalhos de segurança", () => {
	it("serve a página em pt-BR com CSP restritiva, sem referrer, sem iframe e sem cache", async () => {
		const { app } = await make();
		const res = await app.request("/pluggy/conectar");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/html");
		expect(res.headers.get("x-frame-options")).toBe("DENY");
		expect(res.headers.get("referrer-policy")).toBe("no-referrer");
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		expect(res.headers.get("cross-origin-opener-policy")).toBeNull();
		const csp = res.headers.get("content-security-policy") ?? "";
		expect(csp).toContain("default-src 'none'");
		expect(csp).toContain("script-src 'self'");
		expect(csp).not.toMatch(/script-src[^;]*unsafe/);
		expect(csp).toContain("connect-src 'self'");
		expect(csp).toContain("frame-src https://connect.pluggy.ai");
		expect(csp).toContain("frame-ancestors 'none'");
		expect(csp).toContain("base-uri 'none'");
		expect(csp).toContain("form-action 'none'");
		const html = await res.text();
		expect(html).toContain('lang="pt-BR"');
		expect(html).toContain(`<script src="${ASSET.path}"></script>`);
		expect(html.match(/<script/g)).toHaveLength(1);
		expect(html).toContain("orbita://configuracoes/bancos");
		expect(html).not.toMatch(/https?:\/\//);
	});

	it("serve o widget com o nome do hash e cache longo; outro nome é 404", async () => {
		const { app } = await make();
		const res = await app.request(ASSET.path);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/javascript");
		expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
		expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
		expect(await res.text()).toBe("/*widget*/");
		expect((await app.request("/pluggy/conectar/app.00000000.js")).status).toBe(404);
		expect((await app.request("/pluggy/conectar/..%2Fsecret")).status).toBe(404);
	});

	it("as rotas JSON públicas também levam os cabeçalhos", async () => {
		const { app } = await make();
		const res = await app.request("/pluggy/connect-token", { method: "POST" });
		expect(res.headers.get("x-frame-options")).toBe("DENY");
		expect(res.headers.get("cache-control")).toBe("no-store");
	});

	it("se o widget não monta, a página responde 503 sem derrubar nada", async () => {
		const t = await setupFinance(NOW, undefined, {
			pluggyConnectAsset: async () => {
				throw new Error("falhou");
			},
		});
		const res = await t.app.request("/pluggy/conectar");
		expect(res.status).toBe(503);
		expect((await t.app.request("/health")).status).toBe(200);
	});

	it("o resto da API mantém os cabeçalhos padrão", async () => {
		const { app } = await make();
		const res = await app.request("/health");
		expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
	});
});

describe("widget empacotado de verdade", () => {
	it("monta o pluggy-connect-sdk num arquivo só, com o hash no nome e sem eval", async () => {
		const asset = await buildConnectAsset();
		expect(asset.path).toMatch(/^\/pluggy\/conectar\/app\.[0-9a-f]{8}\.js$/);
		const text = new TextDecoder().decode(asset.code);
		expect(text).toContain("https://connect.pluggy.ai");
		expect(text).not.toMatch(/\beval\(|new Function\(/);
		expect(text).toContain("/pluggy/connect-complete");
		expect(text).toContain("includeSandbox");
	}, 30_000);
});
