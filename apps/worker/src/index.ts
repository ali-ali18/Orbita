import { createDb, createPrismaStores, createSecretVault } from "@orbita/db";
import { PLUGGY_DAILY_JOB, PLUGGY_SYNC_QUEUE } from "@orbita/ingest";
import { deriveKey } from "@orbita/security";
import { Queue, Worker } from "bullmq";
import { loadEnv } from "./env.ts";
import { CLEAN_PAIRING_CODES, cleanPairingCodes, MAINTENANCE_QUEUE } from "./maintenance.ts";
import { PLUGGY_DAILY_PATTERN, PLUGGY_DAILY_TIME_ZONE, processSyncJob } from "./sincronizacao.ts";

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const stores = createPrismaStores(db);
const store = stores.auth;
const vault = createSecretVault({ store: stores.secrets, key: deriveKey(env.APP_SECRET, "secret-box") });
const connection = { url: env.REDIS_URL, maxRetriesPerRequest: null };

const queue = new Queue(MAINTENANCE_QUEUE, { connection });
await queue.upsertJobScheduler(CLEAN_PAIRING_CODES, { every: 60 * 60_000 }, { name: CLEAN_PAIRING_CODES });

const worker = new Worker(
	MAINTENANCE_QUEUE,
	async (job) => {
		if (job.name === CLEAN_PAIRING_CODES) return cleanPairingCodes({ store, now: () => new Date() });
		throw new Error(`Tarefa desconhecida: ${job.name}`);
	},
	{ connection },
);

worker.on("completed", (job, result) => console.log(`[${job.name}] ok`, result));
worker.on("failed", (job, err) => console.error(`[${job?.name}] falhou: ${err.message}`));

// Meu Pluggy: um job por dia e o pedido do app caem na mesma fila e no mesmo processador. Concorrência 1:
// duas sincronizações nunca rodam ao mesmo tempo.
const syncQueue = new Queue(PLUGGY_SYNC_QUEUE, { connection });
await syncQueue.upsertJobScheduler(
	PLUGGY_DAILY_JOB,
	{ pattern: PLUGGY_DAILY_PATTERN, tz: PLUGGY_DAILY_TIME_ZONE },
	{ name: PLUGGY_DAILY_JOB },
);
const syncWorker = new Worker(
	PLUGGY_SYNC_QUEUE,
	(job) =>
		processSyncJob(job.name, {
			stores,
			readSecret: (name) => vault.read(name),
			fetch: (url, init) => fetch(url, init),
			now: () => new Date(),
			log: (line) => console.log(line),
		}),
	{ connection, concurrency: 1 },
);
// O resultado traz só contagens e mensagens já sanitizadas.
syncWorker.on("completed", (job, result) => console.log(`[${job.name}] ${result.status}`));
syncWorker.on("failed", (job, err) => console.error(`[${job?.name}] falhou: ${err.message}`));
console.log("Worker rodando.");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, async () => {
		await worker.close();
		await syncWorker.close();
		await queue.close();
		await syncQueue.close();
		await db.$disconnect();
		process.exit(0);
	});
}
