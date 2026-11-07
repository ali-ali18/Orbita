import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createDb, createPrismaStores } from "@orbita/db";
import { deriveKey } from "@orbita/security";
import { createApp } from "./app.ts";
import { loadEnv } from "./env.ts";
import { startAutoPairing } from "./modules/pairing/auto.ts";
import { createPairingGuard } from "./modules/pairing/guard.ts";
import { createSecretVault } from "./modules/settings/service.ts";
import { createFsOtaStore } from "./modules/updates/store.ts";

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
const app = createApp({
	...deps,
	stores,
	guard,
	vault,
	version,
	trustedProxyHops: env.TRUSTED_PROXY_HOPS,
	ota: createFsOtaStore(env.OTA_DIR),
});

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
	console.log(`API ouvindo na porta ${info.port}`);
});

const stopAutoPairing = env.PAIRING_AUTO
	? startAutoPairing({ deps, guard, log: { info: console.log, error: console.error } })
	: () => {};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		stopAutoPairing();
		server.close(async () => {
			await db.$disconnect();
			process.exit(0);
		});
	});
}
