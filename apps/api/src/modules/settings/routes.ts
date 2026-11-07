import { isSecretName, parseSecretValue, type SecretName, secretPutBody } from "@orbita/shared";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { apiError } from "../../http/errors.ts";
import type { ModuleDeps } from "../../http/module-deps.ts";
import type { AppEnv } from "../../http/require-device.ts";
import { validate } from "../../http/validate.ts";
import type { SecretVault } from "./service.ts";

export type SettingsRoutesDeps = ModuleDeps & {
	vault: SecretVault;
	/** Versão do servidor (injetada; vem do package.json da API). */
	version: string;
};

type SecretEnv = AppEnv & { Variables: { secretName: SecretName } };

/** Tela "Servidor e chaves". Nenhuma rota devolve o valor de uma chave, nem parte dele. */
export function routes({ vault, version, requireDevice }: SettingsRoutesDeps) {
	// Nome fora da lista = 404, antes de olhar o corpo.
	const knownName = createMiddleware<SecretEnv>(async (c, next) => {
		const name = c.req.param("name") ?? "";
		if (!isSecretName(name)) return c.json(apiError("nao_encontrado", "Chave não encontrada."), 404);
		c.set("secretName", name);
		await next();
	});

	return new Hono<SecretEnv>()
		.use("/v1/server", requireDevice)
		.use("/v1/settings/*", requireDevice)
		.get("/v1/server", (c) => {
			const device = c.get("device");
			return c.json({ version, device: { name: device.name, pairedAt: device.createdAt.toISOString() } });
		})
		.get("/v1/settings/secrets", async (c) => c.json({ secrets: await vault.status() }))
		.put("/v1/settings/secrets/:name", knownName, validate("json", secretPutBody), async (c) => {
			const name = c.get("secretName");
			const parsed = parseSecretValue(name, c.req.valid("json").value);
			if (!parsed.ok) return c.json(apiError("dados_invalidos", parsed.message), 400);
			return c.json({ secret: await vault.put(name, parsed.value) });
		})
		.delete("/v1/settings/secrets/:name", knownName, async (c) =>
			c.json({ secret: await vault.remove(c.get("secretName")) }),
		);
}
