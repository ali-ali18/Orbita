import { createSecretVault } from "@orbita/db";
import { createSecretBox } from "@orbita/security";
import { describe, expect, it } from "vitest";
import { type Json, setupFinance } from "../../test-support.ts";

const ANTHROPIC = "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const PLUGGY_ID = "123e4567-e89b-42d3-a456-426614174000";
const PLUGGY_SECRET = "9f8e7d6c-5b4a-4321-8fed-cba987654321";
const KEY = Buffer.alloc(32, 7);

describe("GET /v1/server", () => {
	it("exige o token e devolve versão e dados do aparelho", async () => {
		const { call, api } = await setupFinance();
		expect((await call("GET", "/v1/server", undefined, null)).status).toBe(401);
		const res = await api.get("/v1/server");
		expect(res.status).toBe(200);
		expect(res.body).toEqual({
			version: "0.0.0-test",
			device: { name: "Teste", pairedAt: expect.stringMatching(/^2026-11-15T15:00:00/) },
		});
	});
});

describe("chaves do servidor", () => {
	it("sem token, tudo dá 401", async () => {
		const { call } = await setupFinance();
		// Nome desconhecido sem token também é 401: não revela quais nomes existem.
		expect((await call("PUT", "/v1/settings/secrets/outra_chave", { value: ANTHROPIC }, null)).status).toBe(
			401,
		);
		expect((await call("DELETE", "/v1/settings/secrets/outra_chave", undefined, null)).status).toBe(401);
		expect((await call("GET", "/v1/settings/secrets", undefined, null)).status).toBe(401);
		expect(
			(await call("PUT", "/v1/settings/secrets/anthropic_api_key", { value: ANTHROPIC }, null)).status,
		).toBe(401);
		expect((await call("DELETE", "/v1/settings/secrets/anthropic_api_key", undefined, null)).status).toBe(
			401,
		);
	});

	it("lista sempre as 3 chaves, na ordem, não configuradas", async () => {
		const { api } = await setupFinance();
		const res = await api.get("/v1/settings/secrets");
		expect(res.status).toBe(200);
		expect(res.body).toEqual({
			secrets: [
				{ name: "anthropic_api_key", configured: false, readable: false, updatedAt: null, updatedBy: null },
				{ name: "pluggy_client_id", configured: false, readable: false, updatedAt: null, updatedBy: null },
				{
					name: "pluggy_client_secret",
					configured: false,
					readable: false,
					updatedAt: null,
					updatedBy: null,
				},
			],
		});
	});

	it("grava, lista como configurada e nunca devolve o valor nem pedaço dele", async () => {
		const { api, vault } = await setupFinance();
		const values = {
			anthropic_api_key: `  ${ANTHROPIC}  `,
			pluggy_client_id: PLUGGY_ID,
			pluggy_client_secret: PLUGGY_SECRET,
		};
		const bodies: string[] = [];
		for (const [name, value] of Object.entries(values)) {
			const put = await api.put(`/v1/settings/secrets/${name}`, { value });
			expect(put.status).toBe(200);
			expect(put.body).toEqual({
				secret: {
					name,
					configured: true,
					readable: true,
					updatedAt: "2026-11-15T15:00:00.000Z",
					updatedBy: "Teste",
				},
			});
			bodies.push(JSON.stringify(put.body));
		}
		const list = await api.get("/v1/settings/secrets");
		bodies.push(JSON.stringify(list.body));
		expect(list.body.secrets.map((s: { configured: boolean }) => s.configured)).toEqual([true, true, true]);
		for (const item of list.body.secrets)
			expect(Object.keys(item).sort()).toEqual(["configured", "name", "readable", "updatedAt", "updatedBy"]);

		const everything = bodies.join("\n");
		for (const raw of [ANTHROPIC, PLUGGY_ID, PLUGGY_SECRET]) {
			expect(everything).not.toContain(raw);
			expect(everything).not.toContain(raw.slice(-4));
		}
		expect(everything).not.toContain("v1.");

		// O servidor lê o valor em claro (já sem espaços) pelo cofre.
		expect(await vault.read("anthropic_api_key")).toBe(ANTHROPIC);
		expect(await vault.read("pluggy_client_secret")).toBe(PLUGGY_SECRET);
	});

	it("troca o valor de uma chave já gravada", async () => {
		const { api, vault } = await setupFinance();
		await api.put("/v1/settings/secrets/anthropic_api_key", { value: ANTHROPIC });
		await api.put("/v1/settings/secrets/anthropic_api_key", { value: `${ANTHROPIC}-nova` });
		expect(await vault.read("anthropic_api_key")).toBe(`${ANTHROPIC}-nova`);
	});

	it("rejeita formato inválido com 400 sem ecoar o valor", async () => {
		const { api } = await setupFinance();
		const cases: [string, string][] = [
			["anthropic_api_key", "sk-openai-segredinho-1234567890"],
			["anthropic_api_key", "sk-ant-curta"],
			["anthropic_api_key", `sk-ant-${"a".repeat(300)}`],
			["anthropic_api_key", "sk-ant-com espaco no meio-1234567"],
			["pluggy_client_id", "nao-e-uuid-segredinho"],
			["pluggy_client_secret", "curto"],
			["pluggy_client_secret", "tem espaco no meio 12345"],
			["anthropic_api_key", "   "],
		];
		for (const [name, value] of cases) {
			const res = await api.put(`/v1/settings/secrets/${name}`, { value });
			expect(res.status).toBe(400);
			expect(res.body.error.code).toBe("dados_invalidos");
			expect(res.body.error.message).toMatch(/\S/);
			const text = JSON.stringify(res.body);
			if (value.trim()) expect(text).not.toContain(value.trim());
		}
		const list = await api.get("/v1/settings/secrets");
		expect(list.body.secrets.every((s: { configured: boolean }) => !s.configured)).toBe(true);
	});

	it("corpo errado (sem value, tipo errado, campo extra) dá 400", async () => {
		const { api } = await setupFinance();
		for (const body of [{}, { value: 123 }, { value: ANTHROPIC, extra: 1 }]) {
			expect((await api.put("/v1/settings/secrets/anthropic_api_key", body)).status).toBe(400);
		}
	});

	it("nome desconhecido dá 404 em PUT e DELETE", async () => {
		const { api } = await setupFinance();
		const put = await api.put("/v1/settings/secrets/outra_chave", { value: ANTHROPIC });
		expect(put.status).toBe(404);
		expect(put.body.error).toEqual({ code: "nao_encontrado", message: "Chave não encontrada." });
		expect((await api.delete("/v1/settings/secrets/outra_chave")).status).toBe(404);
	});

	it("DELETE remove (e repetir também responde não configurada)", async () => {
		const { api, vault } = await setupFinance();
		await api.put("/v1/settings/secrets/pluggy_client_id", { value: PLUGGY_ID });
		const del = await api.delete("/v1/settings/secrets/pluggy_client_id");
		expect(del.status).toBe(200);
		expect(del.body).toEqual({
			secret: {
				name: "pluggy_client_id",
				configured: false,
				readable: false,
				updatedAt: null,
				updatedBy: null,
			},
		});
		expect(await vault.read("pluggy_client_id")).toBeNull();
		expect((await api.delete("/v1/settings/secrets/pluggy_client_id")).body.secret.configured).toBe(false);
	});

	it("no banco só fica o texto cifrado, nunca o valor", async () => {
		const { api, stores } = await setupFinance();
		await api.put("/v1/settings/secrets/anthropic_api_key", { value: ANTHROPIC });
		const sealed = await stores.secrets.get("anthropic_api_key");
		expect(sealed).toMatch(/^v1\./);
		expect(sealed).not.toContain(ANTHROPIC);
	});
});

describe("estado da chave com APP_SECRET trocado", () => {
	it("GET diz configured true e readable false quando o texto não abre com a chave do servidor", async () => {
		const { api, stores } = await setupFinance();
		// Grava com outra chave mestra, como se o APP_SECRET tivesse mudado depois.
		const old = createSecretVault({ store: stores.secrets, key: KEY });
		await old.put("anthropic_api_key", ANTHROPIC, "Teste");
		await api.put("/v1/settings/secrets/pluggy_client_id", { value: PLUGGY_ID });

		const get = await api.get("/v1/settings/secrets");
		expect(get.body.secrets.map((s: Json) => [s.name, s.configured, s.readable])).toEqual([
			["anthropic_api_key", true, false],
			["pluggy_client_id", true, true],
			["pluggy_client_secret", false, false],
		]);
		expect(JSON.stringify(get.body)).not.toContain(ANTHROPIC);

		// Um PUT novo regrava com a chave atual e volta a abrir.
		const put = await api.put("/v1/settings/secrets/anthropic_api_key", { value: ANTHROPIC });
		expect(put.body.secret.readable).toBe(true);
		expect((await api.get("/v1/settings/secrets")).body.secrets[0].readable).toBe(true);
	});

	it("o GET mostra readable true quando abre", async () => {
		const { api } = await setupFinance();
		await api.put("/v1/settings/secrets/pluggy_client_id", { value: PLUGGY_ID });
		const get = await api.get("/v1/settings/secrets");
		expect(get.body.secrets[1]).toMatchObject({ configured: true, readable: true, updatedBy: "Teste" });
	});
});

describe("cofre (AAD = nome da chave)", () => {
	it("o texto cifrado de uma chave não abre como outra", async () => {
		const { stores } = await setupFinance();
		const vault = createSecretVault({ store: stores.secrets, key: KEY });
		await vault.put("pluggy_client_id", PLUGGY_ID, "Teste");
		const sealed = (await stores.secrets.get("pluggy_client_id")) as string;
		expect(await vault.read("pluggy_client_id")).toBe(PLUGGY_ID);

		// Copia o ciphertext de uma chave para outra: abrir tem que falhar.
		await stores.secrets.put("pluggy_client_secret", sealed, "Teste");
		await expect(vault.read("pluggy_client_secret")).rejects.toThrow();
		// E o direto com a caixa mostra que só o AAD certo abre.
		const box = createSecretBox(KEY);
		expect(box.open(sealed, "pluggy_client_id")).toBe(PLUGGY_ID);
		expect(() => box.open(sealed, "pluggy_client_secret")).toThrow();
	});

	it("com outra chave mestra o valor não abre", async () => {
		const { stores } = await setupFinance();
		await createSecretVault({ store: stores.secrets, key: KEY }).put("anthropic_api_key", ANTHROPIC, "Teste");
		const other = createSecretVault({ store: stores.secrets, key: Buffer.alloc(32, 9) });
		await expect(other.read("anthropic_api_key")).rejects.toThrow();
	});
});
