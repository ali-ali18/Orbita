import { createAnthropicModelClient } from "@orbita/agents";
import { createDb, createPrismaStores, createSecretVault } from "@orbita/db";
import { PLUGGY_DAILY_JOB, PLUGGY_SYNC_QUEUE } from "@orbita/ingest";
import { deriveKey } from "@orbita/security";
import { Queue, Worker } from "bullmq";
import {
	ALERTS_QUEUE,
	RUN_AGENTS_JOB,
	RUN_AGENTS_PATTERN,
	RUN_AGENTS_TIME_ZONE,
	runDueAgents,
} from "./alertas.ts";
import { chatModelsFromEnv, loadEnv } from "./env.ts";
import {
	CLEAN_IDEMPOTENCY_KEYS,
	CLEAN_PAIRING_CODES,
	cleanIdempotencyKeys,
	cleanPairingCodes,
	MAINTENANCE_QUEUE,
} from "./maintenance.ts";
import {
	PLUGGY_DAILY_PATTERN,
	PLUGGY_DAILY_TIME_ZONE,
	processSyncJob,
	retryAttemptOf,
	schedulePluggyRetries,
} from "./sincronizacao.ts";

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const stores = createPrismaStores(db);
const store = stores.auth;
const vault = createSecretVault({ store: stores.secrets, key: deriveKey(env.APP_SECRET, "secret-box") });
const connection = { url: env.REDIS_URL, maxRetriesPerRequest: null };

const queue = new Queue(MAINTENANCE_QUEUE, { connection });
await queue.upsertJobScheduler(CLEAN_PAIRING_CODES, { every: 60 * 60_000 }, { name: CLEAN_PAIRING_CODES });
await queue.upsertJobScheduler(
	CLEAN_IDEMPOTENCY_KEYS,
	{ every: 60 * 60_000 },
	{ name: CLEAN_IDEMPOTENCY_KEYS },
);

const worker = new Worker(
	MAINTENANCE_QUEUE,
	async (job) => {
		if (job.name === CLEAN_PAIRING_CODES) return cleanPairingCodes({ store, now: () => new Date() });
		if (job.name === CLEAN_IDEMPOTENCY_KEYS)
			return cleanIdempotencyKeys({ store: stores.idempotency, now: () => new Date() });
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
	async (job) => {
		const result = await processSyncJob(
			job.name,
			{
				stores,
				readSecret: (name) => vault.read(name),
				fetch: (url, init) => fetch(url, init),
				now: () => new Date(),
				log: (line) => console.log(line),
			},
			job.data,
		);
		// Conexão que ainda espera o banco (item atualizando, ou nova e sem contas): tenta de novo sozinha, com espera
		// crescente, fim certo e uma cadeia só por conexão. Falhar em agendar não derruba a sincronização que rodou.
		await schedulePluggyRetries(syncQueue, result, retryAttemptOf(job.name, job.data), new Date(), (line) =>
			console.log(line),
		);
		return result;
	},
	{ connection, concurrency: 1 },
);
// O resultado traz só contagens e mensagens já sanitizadas.
syncWorker.on("completed", (job, result) => console.log(`[${job.name}] ${result.status}`));
syncWorker.on("failed", (job, err) => console.error(`[${job?.name}] falhou: ${err.message}`));

// Agentes: a cada hora cheia roda os que estão ligados e na hora. Concorrência 1: duas passadas nunca se cruzam.
const alertsQueue = new Queue(ALERTS_QUEUE, { connection });
await alertsQueue.upsertJobScheduler(
	RUN_AGENTS_JOB,
	{ pattern: RUN_AGENTS_PATTERN, tz: RUN_AGENTS_TIME_ZONE },
	{ name: RUN_AGENTS_JOB },
);
const alertsWorker = new Worker(
	ALERTS_QUEUE,
	async (job) => {
		if (job.name !== RUN_AGENTS_JOB) throw new Error(`Tarefa desconhecida: ${job.name}`);
		return runDueAgents({
			stores,
			now: () => new Date(),
			readApiKey: () => vault.read("anthropic_api_key"),
			createClient: (apiKey) => createAnthropicModelClient({ apiKey }),
			models: chatModelsFromEnv(env),
			aiWording: env.AGENT_AI_WORDING,
			log: (line) => console.log(line),
		});
	},
	{ connection, concurrency: 1 },
);
// O resultado traz só contagens.
alertsWorker.on("completed", (job, result) => console.log(`[${job.name}]`, result));
alertsWorker.on("failed", (job, err) => console.error(`[${job?.name}] falhou: ${err.message}`));
console.log("Worker rodando.");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, async () => {
		await worker.close();
		await syncWorker.close();
		await alertsWorker.close();
		await queue.close();
		await syncQueue.close();
		await alertsQueue.close();
		await db.$disconnect();
		process.exit(0);
	});
}
