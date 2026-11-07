import { PLUGGY_MANUAL_JOB, PLUGGY_MANUAL_JOB_ID, PLUGGY_SYNC_QUEUE } from "@orbita/ingest";
import { Queue } from "bullmq";

export type PluggyQueueState = "idle" | "queued" | "running";

/** O que a API precisa da fila: pedir uma sincronização e saber como ela está. Quem executa é o worker. */
export interface PluggySyncQueue {
	/** Pede uma sincronização agora. Pedido repetido enquanto outro espera ou roda vira o mesmo. */
	enqueue(): Promise<Exclude<PluggyQueueState, "idle">>;
	state(): Promise<PluggyQueueState>;
	close(): Promise<void>;
}

/** BullMQ sobre o mesmo Redis do worker. O `jobId` fixo é o que junta pedidos repetidos num só. */
export function createBullSyncQueue(redisUrl: string): PluggySyncQueue {
	const queue = new Queue(PLUGGY_SYNC_QUEUE, { connection: { url: redisUrl, maxRetriesPerRequest: null } });
	async function state(): Promise<PluggyQueueState> {
		const job = await queue.getJob(PLUGGY_MANUAL_JOB_ID);
		const jobState = job ? await job.getState() : null;
		if (jobState === "active") return "running";
		if (jobState !== null && jobState !== "completed" && jobState !== "failed") return "queued";
		// O job diário também conta como "rodando".
		const { active } = await queue.getJobCounts("active");
		return (active ?? 0) > 0 ? "running" : "idle";
	}
	return {
		async enqueue() {
			await queue.add(
				PLUGGY_MANUAL_JOB,
				{},
				{ jobId: PLUGGY_MANUAL_JOB_ID, removeOnComplete: true, removeOnFail: true },
			);
			const current = await state();
			return current === "running" ? "running" : "queued";
		},
		state,
		close: () => queue.close(),
	};
}
