import {
	type ChatModelConfig,
	createAnthropicModelClient,
	DEFAULT_CHAT_MODEL_CONFIG,
	type ModelClient,
} from "@orbita/agents";
import type { SecretVault, Stores } from "@orbita/db";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { apiError, errorHandler, notFoundHandler } from "./http/errors.ts";
import { createRequireDevice } from "./http/require-device.ts";
import * as accounts from "./modules/accounts/routes.ts";
import * as agents from "./modules/agents/routes.ts";
import * as budgets from "./modules/budgets/routes.ts";
import * as cards from "./modules/cards/routes.ts";
import * as categories from "./modules/categories/routes.ts";
import * as categoryRules from "./modules/category-rules/routes.ts";
import * as chat from "./modules/chat/routes.ts";
import * as devices from "./modules/devices/routes.ts";
import * as economy from "./modules/economy/routes.ts";
import * as exportData from "./modules/export/routes.ts";
import * as goals from "./modules/goals/routes.ts";
import * as home from "./modules/home/routes.ts";
import * as imports from "./modules/imports/routes.ts";
import * as income from "./modules/income/routes.ts";
import * as pairing from "./modules/pairing/routes.ts";
import * as plan from "./modules/plan/routes.ts";
import * as pluggyConnect from "./modules/pluggy/connect/routes.ts";
import type { PluggySyncQueue } from "./modules/pluggy/queue.ts";
import * as pluggy from "./modules/pluggy/routes.ts";
import * as preferences from "./modules/preferences/routes.ts";
import * as recurrences from "./modules/recurrences/routes.ts";
import * as reports from "./modules/reports/routes.ts";
import * as settings from "./modules/settings/routes.ts";
import * as summary from "./modules/summary/routes.ts";
import * as transactions from "./modules/transactions/routes.ts";
import * as updates from "./modules/updates/routes.ts";

export type AppDeps = pairing.PairingRoutesDeps & {
	/** De onde vêm as atualizações OTA do app (disco em produção, memória nos testes). */
	ota: updates.UpdatesRoutesDeps["ota"];
	/** Todas as stores de dados (Prisma em produção, memória nos testes). */
	stores: Stores;
	/** Cofre das chaves do servidor (cifra com a chave derivada do APP_SECRET). */
	vault: SecretVault;
	/** Versão do servidor, mostrada em "Servidor e chaves". */
	version: string;
	/** Fila do Meu Pluggy (Redis). Ausente = o app cadastra conexões mas não dispara sincronização. */
	pluggySyncQueue?: PluggySyncQueue | null;
	/** `fetch` com que a API confere uma conexão nova no Pluggy (os testes injetam um falso). */
	pluggyFetch?: pluggy.PluggyRoutesDeps["fetch"];
	/** Só para testes: o widget já empacotado, em vez de montar o do SDK. */
	pluggyConnectAsset?: pluggyConnect.PluggyConnectRoutesDeps["asset"];
	/** Chat com a IA: modelos (padrão em `@orbita/agents`) e a fábrica do cliente (os testes injetam um falso). */
	chatModels?: ChatModelConfig;
	chatClient?: (apiKey: string) => ModelClient;
	/** Pedidos de chat por aparelho a cada 10 minutos. */
	chatRateLimit?: number;
};

const MAX_BODY_BYTES = 16 * 1024;

export function createApp(deps: AppDeps) {
	const app = new Hono();

	// Sem CORS de propósito: o cliente é um app nativo, não um navegador. Habilitar
	// CORS só abriria a API para páginas web de terceiros.
	// `/pluggy/*` (a página do Pluggy Connect) traz os seus próprios cabeçalhos, com CSP: o mesmo `secureHeaders`
	// global os sobrescreveria (ele escreve depois da rota).
	const defaultHeaders = secureHeaders();
	app.use(async (c, next) => (c.req.path.startsWith("/pluggy/") ? next() : defaultHeaders(c, next)));
	// Importar extrato recebe um arquivo de até 5 MB: o módulo aplica o próprio limite, depois de autenticar.
	const smallBody = bodyLimit({
		maxSize: MAX_BODY_BYTES,
		onError: (c) => c.json(apiError("corpo_grande", "O pedido é grande demais."), 413),
	});
	// O chat aceita anexos (foto ou PDF): `POST /v1/chat` tem o próprio limite, aplicado depois de autenticar.
	app.use(async (c, next) =>
		c.req.path.startsWith("/v1/imports") || (c.req.method === "POST" && c.req.path === "/v1/chat")
			? next()
			: smallBody(c, next),
	);

	app.get("/health", (c) => c.json({ ok: true }));
	// Módulo novo = pasta em `modules/` + uma linha aqui.
	const finance = { stores: deps.stores, now: deps.now, requireDevice: createRequireDevice(deps) };
	const routed = app
		.route("/", pairing.routes(deps))
		.route("/", devices.routes(deps))
		.route("/", accounts.routes(finance))
		.route("/", cards.routes(finance))
		.route("/", categories.routes(finance))
		.route("/", categoryRules.routes(finance))
		.route("/", budgets.routes(finance))
		.route("/", recurrences.routes(finance))
		.route("/", goals.routes(finance))
		.route("/", income.routes(finance))
		.route("/", plan.routes(finance))
		.route("/", transactions.routes(finance))
		.route("/", imports.routes(finance))
		.route("/", exportData.routes(finance))
		.route("/", preferences.routes(finance))
		.route("/", home.routes(finance))
		.route("/", summary.routes(finance))
		.route("/", reports.routes(finance))
		.route("/", agents.routes(finance))
		.route("/", economy.routes(finance))
		.route(
			"/",
			chat.routes({
				...finance,
				vault: deps.vault,
				models: deps.chatModels ?? DEFAULT_CHAT_MODEL_CONFIG,
				createClient: deps.chatClient ?? ((apiKey) => createAnthropicModelClient({ apiKey })),
				...(deps.chatRateLimit === undefined ? {} : { rateLimitPerWindow: deps.chatRateLimit }),
			}),
		)
		.route(
			"/",
			settings.routes({
				...finance,
				vault: deps.vault,
				version: deps.version,
				chatModels: deps.chatModels ?? DEFAULT_CHAT_MODEL_CONFIG,
			}),
		)
		.route("/", updates.routes(deps))
		.route(
			"/",
			pluggy.routes({
				...finance,
				vault: deps.vault,
				syncQueue: deps.pluggySyncQueue ?? null,
				...(deps.pluggyFetch ? { fetch: deps.pluggyFetch } : {}),
			}),
		)
		.route(
			"/",
			pluggyConnect.routes({
				sessions: deps.stores.pluggyConnectSessions,
				connections: deps.stores.pluggyConnections,
				devices: deps.stores.auth,
				vault: deps.vault,
				syncQueue: deps.pluggySyncQueue ?? null,
				now: deps.now,
				trustedProxyHops: deps.trustedProxyHops,
				...(deps.pluggyFetch ? { fetch: deps.pluggyFetch } : {}),
				...(deps.pluggyConnectAsset ? { asset: deps.pluggyConnectAsset } : {}),
			}),
		);

	app.notFound(notFoundHandler);
	app.onError(errorHandler);
	return routed;
}

export type AppType = ReturnType<typeof createApp>;
