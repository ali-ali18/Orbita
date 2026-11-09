import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { serve } from "@hono/node-server";
import { createDb, createPrismaStores, createSecretVault } from "@orbita/db";
import { deriveKey } from "@orbita/security";
import { createApp } from "./app.ts";
import { chatModelsFromEnv, loadEnv } from "./env.ts";
import { startAutoPairing } from "./modules/pairing/auto.ts";
import { createPairingGuard } from "./modules/pairing/guard.ts";
import { createBullSyncQueue } from "./modules/pluggy/queue.ts";
import { createFsOtaStore } from "./modules/updates/store.ts";

/**
 * Tem de ficar acima do tempo que o proxy mantém a conexão ociosa com a API: 90 s no Traefik (padrão do Go),
 * 2 min no Caddy. Com 65 s, o Node fecharia antes e a reutilização cairia com 502.
 */
const KEEP_ALIVE_TIMEOUT_MS = 130_000;

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const stores = createPrismaStores(db);
await stores.categories.ensureDefaults();
const deps = {
	store: stores.auth,
	pairingKey: deriveKey(env.APP_SECRET, "pairing-code"),
	now: () => new Date(),
};
// Uma instância só, compartilhada pela rota de claim e pelo laço automático.
const guard = createPairingGuard(() => deps.now().getTime());
const vault = createSecretVault({ store: stores.secrets, key: deriveKey(env.APP_SECRET, "secret-box") });
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
	version: string;
};
const pluggySyncQueue = env.REDIS_URL ? createBullSyncQueue(env.REDIS_URL) : null;
const app = createApp({
	...deps,
	stores,
	guard,
	vault,
	version,
	trustedProxyHops: env.TRUSTED_PROXY_HOPS,
	ota: createFsOtaStore(env.OTA_DIR),
	pluggySyncQueue,
	chatModels: chatModelsFromEnv(env),
});

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
	console.log(`API ouvindo na porta ${info.port}`);
});
// Atrás de Traefik/Caddy, o padrão do Node (5 s) fecha a conexão antes do proxy; um POST que reutiliza essa
// conexão cai com 502. O timeout de cabeçalhos fica um pouco acima do keep-alive (exigência do Node).
// `serve` tipa o retorno como união com HTTP/2; aqui é sempre HTTP/1.
const http1 = server as Server;
http1.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
http1.headersTimeout = KEEP_ALIVE_TIMEOUT_MS + 1_000;

const stopAutoPairing = env.PAIRING_AUTO
	? startAutoPairing({ deps, guard, log: { info: console.log, error: console.error } })
	: () => {};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		stopAutoPairing();
		server.close(async () => {
			await pluggySyncQueue?.close();
			await db.$disconnect();
			process.exit(0);
		});
	});
}
