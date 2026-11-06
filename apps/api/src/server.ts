import { serve } from "@hono/node-server";
import { createDb, createPrismaAuthStore } from "@orbita/db";
import { deriveKey } from "@orbita/security";
import { createApp } from "./app.ts";
import { loadEnv } from "./env.ts";
import { startAutoPairing } from "./modules/pairing/auto.ts";
import { createPairingGuard } from "./modules/pairing/guard.ts";

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const deps = {
	store: createPrismaAuthStore(db),
	pairingKey: deriveKey(env.APP_SECRET, "pairing-code"),
	now: () => new Date(),
};
// Uma instância só, compartilhada pela rota de claim e pelo laço automático.
const guard = createPairingGuard(() => deps.now().getTime());
const app = createApp({ ...deps, guard, trustedProxyHops: env.TRUSTED_PROXY_HOPS });

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
