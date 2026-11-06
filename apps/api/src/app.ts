import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { apiError, errorHandler, notFoundHandler } from "./http/errors.ts";
import * as devices from "./modules/devices/routes.ts";
import * as pairing from "./modules/pairing/routes.ts";

export type AppDeps = pairing.PairingRoutesDeps;

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
	const routed = app.route("/", pairing.routes(deps)).route("/", devices.routes(deps));

	app.notFound(notFoundHandler);
	app.onError(errorHandler);
	return routed;
}

export type AppType = ReturnType<typeof createApp>;
