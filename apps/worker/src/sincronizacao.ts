import {
	PLUGGY_DAILY_JOB,
	PLUGGY_MANUAL_JOB,
	type SyncPluggyDeps,
	type SyncPluggyResult,
	syncPluggy,
} from "@orbita/ingest";

/** Todo dia, 06:00 em São Paulo (o diário e o pedido do app usam o mesmo processador). */
export const PLUGGY_DAILY_PATTERN = "0 6 * * *";
export const PLUGGY_DAILY_TIME_ZONE = "America/Sao_Paulo";

/** Liga o nome do job à função pura. Desconhecido lança (o BullMQ marca como falho). */
export async function processSyncJob(jobName: string, deps: SyncPluggyDeps): Promise<SyncPluggyResult> {
	if (jobName === PLUGGY_DAILY_JOB || jobName === PLUGGY_MANUAL_JOB) return syncPluggy(deps);
	throw new Error(`Tarefa desconhecida: ${jobName}`);
}
