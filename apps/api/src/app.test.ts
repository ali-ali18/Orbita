import { createMemoryAuthStore } from "@orbita/db";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { createPairingCode, hashPairingCode, type PairingDeps } from "./pairing/pairing.ts";

function setup() {
	const deps: PairingDeps = { store: createMemoryAuthStore(), secret: "s".repeat(48), now: () => new Date() };
	return { deps, app: createApp(deps) };
}

const json = (body: unknown) => ({
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify(body),
});

async function pair(ctx: ReturnType<typeof setup>) {
	const { code } = await createPairingCode(ctx.deps);
	const res = await ctx.app.request("/v1/pairing/claim", json({ code, deviceName: "Galaxy" }));
	return { res, body: (await res.json()) as { token: string; device: { id: string; name: string } } };
}

describe("API", () => {
	it("GET /health", async () => {
		const { app } = setup();
		const res = await app.request("/health");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});

	it("pareia, identifica o aparelho e desconecta", async () => {
		const ctx = setup();
		const { res, body } = await pair(ctx);
		expect(res.status).toBe(201);
		expect(body.device.name).toBe("Galaxy");

		const auth = { headers: { authorization: `Bearer ${body.token}` } };
		const me = await ctx.app.request("/v1/me", auth);
		expect(me.status).toBe(200);
		expect(((await me.json()) as { device: { id: string } }).device.id).toBe(body.device.id);

		const out = await ctx.app.request("/v1/devices/current", { method: "DELETE", ...auth });
		expect(out.status).toBe(204);
		expect((await ctx.app.request("/v1/me", auth)).status).toBe(401);
	});

	it("código errado devolve 401 com mensagem para o usuário", async () => {
		const ctx = setup();
		const now = ctx.deps.now();
		await ctx.deps.store.replaceActivePairingCode({
			codeHash: hashPairingCode(ctx.deps.secret, "123456"),
			expiresAt: new Date(now.getTime() + 60_000),
			now,
		});
		const res = await ctx.app.request("/v1/pairing/claim", json({ code: "999999", deviceName: "Galaxy" }));
		expect(res.status).toBe(401);
		expect(((await res.json()) as { error: { code: string } }).error.code).toBe("codigo_invalido");
	});

	it("corpo inválido devolve 400 com a mensagem do schema", async () => {
		const { app } = setup();
		const res = await app.request("/v1/pairing/claim", json({ code: "12", deviceName: "Galaxy" }));
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({
			error: { code: "dados_invalidos", message: "O código tem 6 números." },
		});
	});

	it("rotas protegidas recusam sem token ou com token inválido", async () => {
		const { app } = setup();
		expect((await app.request("/v1/me")).status).toBe(401);
		expect((await app.request("/v1/me", { headers: { authorization: "Bearer orb_falso" } })).status).toBe(
			401,
		);
	});

	it("rota desconhecida devolve 404 no formato padrão", async () => {
		const { app } = setup();
		const res = await app.request("/v1/nada");
		expect(res.status).toBe(404);
		expect(((await res.json()) as { error: { code: string } }).error.code).toBe("nao_encontrado");
	});
});
