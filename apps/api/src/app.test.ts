import { createMemoryStores } from "@orbita/db";
import { deriveKey } from "@orbita/security";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { createPairingGuard, PAIRING_FAILED_CLAIMS_LIMIT } from "./modules/pairing/guard.ts";
import { createPairingCode, hashPairingCode, type PairingDeps } from "./modules/pairing/service.ts";
import { createSecretVault } from "./modules/settings/service.ts";

function setup() {
	const stores = createMemoryStores();
	const deps: PairingDeps = {
		store: stores.auth,
		pairingKey: deriveKey("s".repeat(48), "pairing-code"),
		now: () => new Date(),
	};
	const guard = createPairingGuard(() => deps.now().getTime());
	const vault = createSecretVault({ store: stores.secrets, key: deriveKey("s".repeat(48), "secret-box") });
	return {
		deps,
		guard,
		app: createApp({ ...deps, stores, guard, vault, version: "0.0.0-test", trustedProxyHops: 1 }),
	};
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
			codeHash: hashPairingCode(ctx.deps.pairingKey, "123456"),
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

	it("manda cabeçalhos de segurança", async () => {
		const { app } = setup();
		const res = await app.request("/health");
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
	});

	it("corpo acima de 16 KB devolve 413 no formato padrão", async () => {
		const { app } = setup();
		const res = await app.request(
			"/v1/pairing/claim",
			json({ code: "123456", deviceName: "x".repeat(20_000) }),
		);
		expect(res.status).toBe(413);
		expect(((await res.json()) as { error: { code: string } }).error.code).toBe("corpo_grande");
	});

	it("aparelho pareado convida outro com POST /v1/pairing/codes", async () => {
		const ctx = setup();
		const { body } = await pair(ctx);
		const auth = { headers: { authorization: `Bearer ${body.token}` } };

		expect((await ctx.app.request("/v1/pairing/codes", { method: "POST" })).status).toBe(401);

		const res = await ctx.app.request("/v1/pairing/codes", { method: "POST", ...auth });
		expect(res.status).toBe(201);
		const invite = (await res.json()) as { code: string; expiresAt: string };
		expect(invite.code).toMatch(/^\d{6}$/);
		expect(new Date(invite.expiresAt).getTime()).toBeGreaterThan(Date.now());

		const second = await ctx.app.request(
			"/v1/pairing/claim",
			json({ code: invite.code, deviceName: "iPad" }),
		);
		expect(second.status).toBe(201);
	});

	it("limita convites a 5 por hora por aparelho", async () => {
		const ctx = setup();
		const { body } = await pair(ctx);
		const req = () =>
			ctx.app.request("/v1/pairing/codes", {
				method: "POST",
				headers: { authorization: `Bearer ${body.token}` },
			});
		for (let i = 0; i < 5; i++) expect((await req()).status).toBe(201);
		const blocked = await req();
		expect(blocked.status).toBe(429);
		expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
		expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe("muitas_tentativas");
	});

	it("limita tentativas de claim a 10 por IP e conta cada IP separado", async () => {
		const { app } = setup();
		const claim = (ip: string) =>
			app.request("/v1/pairing/claim", {
				...json({ code: "999999", deviceName: "Galaxy" }),
				headers: { "content-type": "application/json", "x-forwarded-for": `1.2.3.4, ${ip}` },
			});
		for (let i = 0; i < 10; i++) expect((await claim("9.9.9.9")).status).toBe(401);
		const blocked = await claim("9.9.9.9");
		expect(blocked.status).toBe(429);
		expect(blocked.headers.get("retry-after")).toBe("600");
		// Entradas forjadas à esquerda não escapam do limite; outro IP real continua livre.
		expect((await claim("8.8.8.8")).status).toBe(401);
	});

	it("depois de 20 erros no total, pausa o claim para todos os IPs, até com o código certo", async () => {
		const ctx = setup();
		const claim = (ip: string, code: string) =>
			ctx.app.request("/v1/pairing/claim", {
				...json({ code, deviceName: "Galaxy" }),
				headers: { "content-type": "application/json", "x-forwarded-for": ip },
			});
		let code = "";
		for (let i = 0; i < PAIRING_FAILED_CLAIMS_LIMIT; i++) {
			// Código novo a cada rodada: cada palpite errado é um "mismatch" de verdade.
			({ code } = await createPairingCode(ctx.deps));
			const wrong = code === "999999" ? "000000" : "999999";
			expect((await claim(`7.7.7.${i}`, wrong)).status).toBe(401);
		}
		({ code } = await createPairingCode(ctx.deps));
		const blocked = await claim("8.8.8.8", code);
		expect(blocked.status).toBe(429);
		expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
		const body = (await blocked.json()) as { error: { code: string; message: string } };
		expect(body.error.code).toBe("muitas_tentativas");
		expect(body.error.message).toContain("pausado");
		// O código certo não foi gasto: a recusa veio antes de tocar o banco.
		expect(await ctx.deps.store.findActivePairingCode(ctx.deps.now(), 5)).not.toBeNull();
	});

	it("claims sem código ativo não contam no guard global", async () => {
		const ctx = setup();
		for (let i = 0; i < PAIRING_FAILED_CLAIMS_LIMIT + 5; i++) {
			const res = await ctx.app.request("/v1/pairing/claim", {
				...json({ code: "999999", deviceName: "Galaxy" }),
				headers: { "content-type": "application/json", "x-forwarded-for": `6.6.6.${i}` },
			});
			expect(res.status).toBe(401);
		}
		expect(ctx.guard.status().paused).toBe(false);
		const { code } = await createPairingCode(ctx.deps);
		const ok = await ctx.app.request("/v1/pairing/claim", json({ code, deviceName: "Galaxy" }));
		expect(ok.status).toBe(201);
	});

	it("IPs do mesmo /64 IPv6 dividem o mesmo limite por IP", async () => {
		const { app } = setup();
		const claim = (ip: string) =>
			app.request("/v1/pairing/claim", {
				...json({ code: "999999", deviceName: "Galaxy" }),
				headers: { "content-type": "application/json", "x-forwarded-for": ip },
			});
		for (let i = 0; i < 10; i++) expect((await claim(`2001:db8:1:2::${i + 1}`)).status).toBe(401);
		expect((await claim("2001:db8:1:2:ffff::9")).status).toBe(429);
		expect((await claim("2001:db8:1:3::1")).status).toBe(401);
	});
});
