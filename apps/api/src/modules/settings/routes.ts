import {
	CHAT_MODEL_OPTIONS,
	type ChatModelConfig,
	FAST_MODEL_OFF,
	isFastModelChoice,
	isMainModel,
	listPrice,
	resolveChatModels,
} from "@orbita/agents";
import { monthOf, toLocalDate } from "@orbita/core";
import type { SecretVault } from "@orbita/db";
import {
	type AiSettingsResponse,
	aiSettingsPutBody,
	isSecretName,
	parseSecretValue,
	type SecretName,
	secretPutBody,
} from "@orbita/shared";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { apiError } from "../../http/errors.ts";
import type { ModuleDeps } from "../../http/module-deps.ts";
import type { AppEnv } from "../../http/require-device.ts";
import { validate } from "../../http/validate.ts";
import { describeOffer, type OtaStore } from "../updates/service.ts";

export type SettingsRoutesDeps = ModuleDeps & {
	vault: SecretVault;
	/** Versão do servidor (injetada; vem do package.json da API). */
	version: string;
	/** Modelos padrão do servidor (variáveis de ambiente); o que o dono salva no app vence. */
	chatModels: ChatModelConfig;
	/** De onde vêm as atualizações OTA: `GET /v1/server` conta ao app o que o servidor está oferecendo. */
	ota: OtaStore;
};

type SecretEnv = AppEnv & { Variables: { secretName: SecretName } };

/** Tela "Servidor e chaves". Nenhuma rota devolve o valor de uma chave, nem parte dele. */
export function routes({ vault, version, requireDevice, stores, now, chatModels, ota }: SettingsRoutesDeps) {
	// Nome fora da lista = 404, antes de olhar o corpo.
	const knownName = createMiddleware<SecretEnv>(async (c, next) => {
		const name = c.req.param("name") ?? "";
		if (!isSecretName(name)) return c.json(apiError("nao_encontrado", "Chave não encontrada."), 404);
		c.set("secretName", name);
		await next();
	});

	/** Gasto do mês com a IA e o limite. Em dólar, que é como a Anthropic cobra. */
	async function aiSettings(): Promise<AiSettingsResponse> {
		const month = monthOf(toLocalDate(now()));
		const [totals, limitUsdCents, secrets, choice] = await Promise.all([
			stores.aiUsage.monthTotals(month),
			stores.aiUsage.getMonthlyLimit(),
			vault.status(),
			stores.aiUsage.getModelChoice(),
		]);
		const models = resolveChatModels(chatModels, choice);
		const key = secrets.find((secret) => secret.name === "anthropic_api_key");
		return {
			month,
			costMicroUsd: totals.costMicroUsd,
			requests: totals.requests,
			inputTokens: totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens,
			outputTokens: totals.outputTokens,
			limitUsdCents,
			// 1 centavo de dólar = 10.000 micro-dólares.
			blocked: limitUsdCents !== null && totals.costMicroUsd >= limitUsdCents * 10_000,
			keyConfigured: Boolean(key?.configured && key.readable),
			chatModel: models.main,
			chatModelFast: models.fast,
			chatModelCustom: choice.chatModel !== null && isMainModel(choice.chatModel),
			chatModelFastCustom: choice.chatModelFast !== null && isFastModelChoice(choice.chatModelFast),
			modelOptions: CHAT_MODEL_OPTIONS.map((o) => {
				const price = listPrice(o.id);
				return {
					id: o.id,
					label: o.label,
					description: o.description,
					main: o.main,
					fast: o.fast,
					inputMicroUsdPerMTok: price.inputMicroUsd,
					outputMicroUsdPerMTok: price.outputMicroUsd,
					priceToConfirm: !price.known,
				};
			}),
		};
	}

	return new Hono<SecretEnv>()
		.use("/v1/server", requireDevice)
		.use("/v1/settings/*", requireDevice)
		.get("/v1/server", async (c) => {
			const device = c.get("device");
			return c.json({
				version,
				device: { name: device.name, pairedAt: device.createdAt.toISOString() },
				// Diagnóstico do app: "servidor oferece X · app roda Y". `null` = imagem sem atualização.
				ota: await describeOffer(ota, "android"),
			});
		})
		.get("/v1/settings/secrets", async (c) => c.json({ secrets: await vault.status() }))
		.put("/v1/settings/secrets/:name", knownName, validate("json", secretPutBody), async (c) => {
			const name = c.get("secretName");
			const parsed = parseSecretValue(name, c.req.valid("json").value);
			if (!parsed.ok) return c.json(apiError("dados_invalidos", parsed.message), 400);
			return c.json({ secret: await vault.put(name, parsed.value, c.get("device").name) });
		})
		.delete("/v1/settings/secrets/:name", knownName, async (c) =>
			c.json({ secret: await vault.remove(c.get("secretName")) }),
		)
		.get("/v1/settings/ai", async (c) => c.json(await aiSettings()))
		.put("/v1/settings/ai", validate("json", aiSettingsPutBody), async (c) => {
			const body = c.req.valid("json");
			// Valida tudo antes de gravar qualquer coisa.
			if (typeof body.chatModel === "string" && !isMainModel(body.chatModel)) {
				return c.json(apiError("dados_invalidos", "Esse modelo não está na lista permitida."), 400);
			}
			if (typeof body.chatModelFast === "string" && !isFastModelChoice(body.chatModelFast)) {
				return c.json(
					apiError("dados_invalidos", `Modelo rápido: use um da lista ou "${FAST_MODEL_OFF}" para desligar.`),
					400,
				);
			}
			if (body.monthlyLimitUsdCents !== undefined)
				await stores.aiUsage.setMonthlyLimit(body.monthlyLimitUsdCents);
			if (body.chatModel !== undefined || body.chatModelFast !== undefined) {
				await stores.aiUsage.setModelChoice({
					...(body.chatModel !== undefined ? { chatModel: body.chatModel } : {}),
					...(body.chatModelFast !== undefined ? { chatModelFast: body.chatModelFast } : {}),
				});
			}
			return c.json(await aiSettings());
		});
}
