import { serve } from "@hono/node-server";
import { createDb, createPrismaAuthStore } from "@orbita/db";
import { createApp } from "./app.ts";
import { loadEnv } from "./env.ts";

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const app = createApp({ store: createPrismaAuthStore(db), secret: env.APP_SECRET, now: () => new Date() });

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
	console.log(`API ouvindo na porta ${info.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		server.close(async () => {
			await db.$disconnect();
			process.exit(0);
		});
	});
}
