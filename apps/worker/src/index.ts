import { createDb, createPrismaAuthStore } from "@orbita/db";
import { Queue, Worker } from "bullmq";
import { loadEnv } from "./env.ts";
import { CLEAN_PAIRING_CODES, cleanPairingCodes, MAINTENANCE_QUEUE } from "./maintenance.ts";

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const store = createPrismaAuthStore(db);
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
console.log("Worker rodando.");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, async () => {
		await worker.close();
		await queue.close();
		await db.$disconnect();
		process.exit(0);
	});
}
