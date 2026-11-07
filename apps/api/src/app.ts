import type { Stores } from "@orbita/db";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { apiError, errorHandler, notFoundHandler } from "./http/errors.ts";
import { createRequireDevice } from "./http/require-device.ts";
import * as accounts from "./modules/accounts/routes.ts";
import * as budgets from "./modules/budgets/routes.ts";
import * as cards from "./modules/cards/routes.ts";
import * as categories from "./modules/categories/routes.ts";
import * as devices from "./modules/devices/routes.ts";
import * as pairing from "./modules/pairing/routes.ts";
import * as recurrences from "./modules/recurrences/routes.ts";
import * as settings from "./modules/settings/routes.ts";
import type { SecretVault } from "./modules/settings/service.ts";
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
};

const MAX_BODY_BYTES = 16 * 1024;

export function createApp(deps: AppDeps) {
	const app = new Hono();

	// Sem CORS de propósito: o cliente é um app nativo, não um navegador. Habilitar
	// CORS só abriria a API para páginas web de terceiros.
	app.use(secureHeaders());
	app.use(
		bodyLimit({
			maxSize: MAX_BODY_BYTES,
			onError: (c) => c.json(apiError("corpo_grande", "O pedido é grande demais."), 413),
		}),
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
		.route("/", budgets.routes(finance))
		.route("/", recurrences.routes(finance))
		.route("/", transactions.routes(finance))
		.route("/", summary.routes(finance))
		.route("/", settings.routes({ ...finance, vault: deps.vault, version: deps.version }))
		.route("/", updates.routes(deps));

	app.notFound(notFoundHandler);
	app.onError(errorHandler);
	return routed;
}

export type AppType = ReturnType<typeof createApp>;
