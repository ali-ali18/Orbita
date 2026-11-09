import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NOW, setupFinance } from "../../../test-support.ts";
import type { PluggyQueueState, PluggySyncQueue } from "../queue.ts";
import { createConnectAssetLoader, readConnectAsset } from "./assets.ts";
import { bundleConnectWidget, writeConnectWidget } from "./build.ts";
import { createConnectSession, hashConnectToken } from "./session.ts";

const ITEM = "123e4567-e89b-42d3-a456-426614174000";
const FOREIGN = "9f8e7d6c-5b4a-4321-8fed-cba987654321";
const CLIENT_ID = "aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb";
const CLIENT_SECRET = "cccccccc-2222-4333-8444-dddddddddddd";
const API_KEY = "eyJhbGciOiJIUzI1NiJ9.fake-api-key-payload.fake-signature";
const CONNECT_TOKEN = "eyJhbGciOiJIUzI1NiJ9.fake-connect-token.fake-signature";
const ASSET = { path: "/pluggy/conectar/app.abcd1234.js", code: new TextEncoder().encode("/*widget*/") };

const SESSION_AT = new Date(NOW);
const ago = (ms: number) => new Date(SESSION_AT.getTime() - ms).toISOString();

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** Pluggy falso: só conhece o ITEM; o FOREIGN é de outra aplicação (404). */
function pluggyFetch(
	log: { path: string; body: string }[] = [],
	failItems = false,
	item: { createdAt?: string; isSandbox?: boolean } = {},
) {
	return async (url: string, init: RequestInit): Promise<Response> => {
		const u = new URL(url);
		log.push({ path: `${init.method} ${u.pathname}`, body: String(init.body ?? "") });
		if (u.pathname === "/auth") return json({ apiKey: API_KEY });
		if (u.pathname === "/connect_token") return json({ accessToken: CONNECT_TOKEN });
		if (failItems) return json({ message: `erro com ${CLIENT_SECRET}` }, 503);
		if (u.pathname === `/items/${ITEM}`) {
			return json({
				id: ITEM,
				status: "UPDATED",
				createdAt: item.createdAt ?? NOW,
				connector: { name: "Nubank", isSandbox: item.isSandbox ?? false },
			});
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

async function make(
	opts: { keys?: boolean; failItems?: boolean; item?: { createdAt?: string; isSandbox?: boolean } } = {},
) {
	const log: { path: string; body: string }[] = [];
	const q = fakeQueue();
	const t = await setupFinance(NOW, undefined, {
		pluggySyncQueue: q.queue,
		pluggyFetch: pluggyFetch(log, opts.failItems, opts.item),
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
	const deviceId = () => (t.stores.auth as unknown as { devices: { id: string }[] }).devices[0]?.id ?? "";
	return { ...t, q, log, newSession, pub, deviceId };
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
		const stored = await stores.pluggyConnectSessions.find(hashConnectToken(token), now);
		expect(stored?.deviceId).toBeTruthy();
		expect(await stores.pluggyConnectSessions.find(token, now)).toBeNull();
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
		const { stores, pub, deviceId } = await make();
		const old = await createConnectSession(
			stores.pluggyConnectSessions,
			deviceId(),
			new Date("2026-11-15T14:30:00Z"),
		);
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

describe("o item precisa ser desta sessão", () => {
	it("recusa conector de teste (sandbox) sem gastar a sessão", async () => {
		const { newSession, pub, api } = await make({ item: { isSandbox: true } });
		const session = await newSession();
		const res = await pub("/pluggy/connect-complete", { session, itemId: ITEM });
		expect(res.status).toBe(422);
		expect(res.body.error.message).toBe("Bancos de teste (sandbox) não podem ser conectados aqui.");
		expect((await api.get("/v1/pluggy/connections")).body.connections).toEqual([]);
		expect((await pub("/pluggy/connect-token", { session })).status).toBe(200);
	});

	it("recusa item criado antes da sessão (mais de 2 min de folga)", async () => {
		const { newSession, pub, api } = await make({ item: { createdAt: ago(3 * 60_000) } });
		const res = await pub("/pluggy/connect-complete", { session: await newSession(), itemId: ITEM });
		expect(res.status).toBe(422);
		expect(res.body.error.code).toBe("conexao_invalida");
		expect(res.body.error.message).toBe(
			"Essa conexão não é nova. Toque em Conectar banco no app e entre no banco de novo.",
		);
		expect((await api.get("/v1/pluggy/connections")).body.connections).toEqual([]);
	});

	it("aceita item criado até 2 min antes da sessão (relógios) ou depois dela", async () => {
		for (const createdAt of [ago(119_000), ago(0), new Date(SESSION_AT.getTime() + 60_000).toISOString()]) {
			const { newSession, pub } = await make({ item: { createdAt } });
			const res = await pub("/pluggy/connect-complete", { session: await newSession(), itemId: ITEM });
			expect(res.status, createdAt).toBe(200);
		}
	});

	it("item sem data de criação é recusado", async () => {
		const t = await setupFinance(NOW, undefined, {
			pluggyConnectAsset: async () => ASSET,
			pluggyFetch: async (url) => {
				const p = new URL(url).pathname;
				if (p === "/auth") return json({ apiKey: API_KEY });
				return json({ id: ITEM, status: "UPDATED", connector: { name: "Nubank" } });
			},
		});
		await t.api.put("/v1/settings/secrets/pluggy_client_id", { value: CLIENT_ID });
		await t.api.put("/v1/settings/secrets/pluggy_client_secret", { value: CLIENT_SECRET });
		const session = ((await t.api.post("/v1/pluggy/connect-sessions")).body.path as string).split("#s=")[1];
		const res = await t.call("POST", "/pluggy/connect-complete", { session, itemId: ITEM }, null);
		expect(res.status).toBe(422);
	});
});

describe("aparelho revogado", () => {
	it("a sessão deixa de valer no connect-token e no connect-complete", async () => {
		const { newSession, pub, stores, deviceId } = await make();
		const session = await newSession();
		expect((await pub("/pluggy/connect-token", { session })).status).toBe(200);
		await stores.auth.revokeDevice({ deviceId: deviceId(), now: new Date(NOW) });
		const token = await pub("/pluggy/connect-token", { session });
		expect(token.status).toBe(401);
		expect(token.body.error.code).toBe("sessao_invalida");
		const done = await pub("/pluggy/connect-complete", { session, itemId: ITEM });
		expect(done.status).toBe(401);
	});

	it("revogado entre o token do widget e a conclusão não cadastra nada", async () => {
		const { newSession, pub, stores, deviceId } = await make();
		const session = await newSession();
		await pub("/pluggy/connect-token", { session });
		await stores.auth.revokeDevice({ deviceId: deviceId(), now: new Date(NOW) });
		expect((await pub("/pluggy/connect-complete", { session, itemId: ITEM })).status).toBe(401);
		expect(await stores.pluggyConnections.list()).toEqual([]);
	});
});

describe("falha ao cadastrar", () => {
	it("a sessão volta a valer e o dono pode tentar de novo", async () => {
		const { newSession, pub, stores, q } = await make();
		const session = await newSession();
		const real = stores.pluggyConnections.add;
		stores.pluggyConnections.add = async () => {
			throw new Error("banco fora do ar");
		};
		const failed = await pub("/pluggy/connect-complete", { session, itemId: ITEM });
		expect(failed.status).toBe(500);
		expect(q.calls).toEqual([]);
		stores.pluggyConnections.add = real;
		const again = await pub("/pluggy/connect-complete", { session, itemId: ITEM });
		expect(again.status).toBe(200);
		expect(await stores.pluggyConnections.list()).toHaveLength(1);
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

	it("sem o widget a página continua existindo, com aviso, e só limpa o token do endereço", async () => {
		const t = await setupFinance(NOW, undefined, { pluggyConnectAsset: async () => null });
		const res = await t.app.request("/pluggy/conectar");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-security-policy")).toContain("script-src 'self'");
		const html = await res.text();
		expect(html).toContain("Esta página ainda não está pronta neste servidor");
		expect(html).toContain('<script src="/pluggy/conectar/limpar.js"></script>');
		expect(html).not.toContain("Tentar de novo");
		const clear = await t.app.request("/pluggy/conectar/limpar.js");
		expect(clear.status).toBe(200);
		expect(await clear.text()).toContain("history.replaceState");
		expect((await t.app.request("/pluggy/conectar/app.00000000.js")).status).toBe(404);
	});

	it("o resto da API mantém os cabeçalhos padrão", async () => {
		const { app } = await make();
		const res = await app.request("/health");
		expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
	});
});

describe("widget empacotado no build", () => {
	it("o build monta o pluggy-connect-sdk num arquivo só, com o hash no nome e sem eval", async () => {
		const asset = await bundleConnectWidget();
		expect(asset.path).toMatch(/^\/pluggy\/conectar\/app\.[0-9a-f]{8}\.js$/);
		const text = new TextDecoder().decode(asset.code);
		expect(text).toContain("https://connect.pluggy.ai");
		expect(text).not.toMatch(/\beval\(|new Function\(/);
		expect(text).toContain("/pluggy/connect-complete");
		expect(text).toContain("includeSandbox");
	}, 30_000);

	it("grava o arquivo e o manifesto; o servidor só lê e serve (e o build seguinte limpa o antigo)", async () => {
		const dir = await mkdtemp(join(tmpdir(), "orbita-connect-"));
		try {
			const first = await writeConnectWidget(dir, {
				path: "/pluggy/conectar/app.11111111.js",
				code: new TextEncoder().encode("a"),
			});
			const second = await writeConnectWidget(dir, {
				path: "/pluggy/conectar/app.22222222.js",
				code: new TextEncoder().encode("b"),
			});
			expect([first, second]).toEqual(["app.11111111.js", "app.22222222.js"]);
			await expect(readFile(join(dir, first))).rejects.toThrow();
			const asset = await readConnectAsset(dir);
			expect(asset?.path).toBe("/pluggy/conectar/app.22222222.js");
			expect(new TextDecoder().decode(asset?.code)).toBe("b");
			const t = await setupFinance(NOW, undefined, {
				pluggyConnectAsset: createConnectAssetLoader({ dir, now: () => new Date(NOW) }),
			});
			const page = await (await t.app.request("/pluggy/conectar")).text();
			expect(page).toContain('src="/pluggy/conectar/app.22222222.js"');
			expect(await (await t.app.request("/pluggy/conectar/app.22222222.js")).text()).toBe("b");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("manifesto com nome fora do formato (caminho) é recusado", async () => {
		const dir = await mkdtemp(join(tmpdir(), "orbita-connect-"));
		try {
			await writeFile(join(dir, "manifest.json"), JSON.stringify({ file: "../../etc/passwd" }));
			expect(await readConnectAsset(dir)).toBeNull();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("widget ausente: lê o disco uma vez, lembra a falha por 10 min e tenta de novo depois", async () => {
		const dir = await mkdtemp(join(tmpdir(), "orbita-connect-"));
		try {
			let t = Date.parse(NOW);
			const logs: unknown[] = [];
			const load = createConnectAssetLoader({
				dir: join(dir, "nao-existe"),
				now: () => new Date(t),
				log: (e) => logs.push(e),
			});
			for (let i = 0; i < 5; i++) expect(await load()).toBeNull();
			expect(logs).toHaveLength(1);
			t += 9 * 60_000;
			expect(await load()).toBeNull();
			expect(logs).toHaveLength(1);
			t += 2 * 60_000;
			expect(await load()).toBeNull();
			expect(logs).toHaveLength(2);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("reconexão (modo de atualização do mesmo item)", () => {
	const OLD = { createdAt: "2026-06-01T10:00:00.000Z" };
	const reconnectSession = async (t: Awaited<ReturnType<typeof make>>, connectionId = ITEM) => {
		const res = await t.api.post("/v1/pluggy/connect-sessions", { connectionId });
		expect(res.status).toBe(201);
		return (res.body.path as string).split("#s=")[1] as string;
	};

	it("pede o token do widget com o itemId e devolve o item a atualizar", async () => {
		const t = await make({ item: OLD });
		await t.api.post("/v1/pluggy/connections", { itemId: ITEM });
		const session = await reconnectSession(t);
		const res = await t.pub("/pluggy/connect-token", { session });
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ connectToken: CONNECT_TOKEN, updateItem: ITEM });
		const call = t.log.find((l) => l.path === "POST /connect_token");
		expect(JSON.parse(call?.body ?? "{}")).toEqual({ itemId: ITEM, options: { clientUserId: "orbita" } });
	});

	it("aceita o item antigo do dono, não duplica a conexão e enfileira a sincronização", async () => {
		const t = await make({ item: OLD });
		await t.api.post("/v1/pluggy/connections", { itemId: ITEM, label: "Meu nome" });
		const session = await reconnectSession(t);
		const res = await t.pub("/pluggy/connect-complete", { session, itemId: ITEM });
		expect(res.status).toBe(200);
		expect(t.q.calls).toEqual(["enqueue"]);
		const list = (await t.api.get("/v1/pluggy/connections")).body.connections;
		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({ id: ITEM, label: "Meu nome" });
		// Uso único também na reconexão.
		expect((await t.pub("/pluggy/connect-complete", { session, itemId: ITEM })).status).toBe(401);
	});

	it("sem reconexão, item antigo continua recusado", async () => {
		const t = await make({ item: OLD });
		await t.api.post("/v1/pluggy/connections", { itemId: ITEM });
		const res = await t.pub("/pluggy/connect-complete", { session: await t.newSession(), itemId: ITEM });
		expect(res.status).toBe(422);
	});

	it("não abre sessão de reconexão para item que não é do dono", async () => {
		const t = await make({ item: OLD });
		const res = await t.api.post("/v1/pluggy/connect-sessions", { connectionId: FOREIGN });
		expect(res.status).toBe(404);
		const bad = await t.api.post("/v1/pluggy/connect-sessions", { connectionId: "nao-e-uuid" });
		expect(bad.status).toBe(400);
	});

	it("o navegador não troca o item: itemId diferente do da sessão é recusado e não gasta a sessão", async () => {
		const t = await make({ item: OLD });
		await t.api.post("/v1/pluggy/connections", { itemId: ITEM });
		const session = await reconnectSession(t);
		const res = await t.pub("/pluggy/connect-complete", { session, itemId: FOREIGN });
		expect(res.status).toBe(422);
		expect(res.body.error.code).toBe("conexao_invalida");
		expect(t.q.calls).toEqual([]);
		expect((await t.api.get("/v1/pluggy/connections")).body.connections).toHaveLength(1);
		expect((await t.pub("/pluggy/connect-complete", { session, itemId: ITEM })).status).toBe(200);
	});

	it("conexão removida entre a sessão e o fim: recusa", async () => {
		const t = await make({ item: OLD });
		await t.api.post("/v1/pluggy/connections", { itemId: ITEM });
		const session = await reconnectSession(t);
		await t.api.delete(`/v1/pluggy/connections/${ITEM}`);
		expect((await t.pub("/pluggy/connect-token", { session })).status).toBe(401);
		expect((await t.pub("/pluggy/connect-complete", { session, itemId: ITEM })).status).toBe(422);
	});

	it("sandbox continua recusado na reconexão", async () => {
		const t = await make({ item: { ...OLD, isSandbox: true } });
		await t.api.post("/v1/pluggy/connections", { itemId: ITEM });
		const session = await reconnectSession(t);
		expect((await t.pub("/pluggy/connect-complete", { session, itemId: ITEM })).status).toBe(422);
	});
});
