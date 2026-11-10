import {
	PLUGGY_DAILY_JOB,
	PLUGGY_MANUAL_JOB,
	PLUGGY_RETRY_JOB,
	type SyncPluggyDeps,
	type SyncPluggyResult,
	syncPluggy,
} from "@orbita/ingest";

/** Todo dia, 06:00 em São Paulo (o diário e o pedido do app usam o mesmo processador). */
export const PLUGGY_DAILY_PATTERN = "0 6 * * *";
export const PLUGGY_DAILY_TIME_ZONE = "America/Sao_Paulo";

/** Liga o nome do job à função pura. Desconhecido lança (o BullMQ marca como falho). */
export async function processSyncJob(jobName: string, deps: SyncPluggyDeps): Promise<SyncPluggyResult> {
	if (jobName === PLUGGY_DAILY_JOB || jobName === PLUGGY_MANUAL_JOB || jobName === PLUGGY_RETRY_JOB) {
		return syncPluggy(deps);
	}
	throw new Error(`Tarefa desconhecida: ${jobName}`);
}

/**
 * Esperas das novas tentativas quando uma conexão ainda espera o banco (item `UPDATING`, ou conexão nova sem
 * contas): 2, 5, 15, 30 e 60 minutos. Depois disso, mais uma só, logo após a hora em que o Pluggy diz que atualiza
 * o item (`nextAutoSyncAt`); o job diário cobre o resto.
 */
export const PLUGGY_RETRY_DELAYS_MS: readonly number[] = [2, 5, 15, 30, 60].map((m) => m * 60_000);
/** Folga depois do `nextAutoSyncAt`: é a data MÍNIMA da atualização, ela pode atrasar um pouco. */
export const PLUGGY_RETRY_AFTER_UPDATE_MS = 15 * 60_000;

export interface PluggyRetryPlan {
	/** Número desta nova tentativa (1 = a primeira depois de uma sincronização normal). */
	attempt: number;
	delayMs: number;
}

/**
 * Decide a próxima tentativa. `attempt` é o número da tentativa que acabou de rodar (0 = sincronização diária ou
 * pedida pelo app). `null`: nada espera o banco, ou as tentativas acabaram. Função pura: quem agenda é o worker.
 */
export function planPluggyRetry(
	result: SyncPluggyResult,
	attempt: number,
	now: Date,
): PluggyRetryPlan | null {
	const waiting = result.connections.flatMap((c) => (c.retry ? [c.retry] : []));
	if (waiting.length === 0 || !Number.isInteger(attempt) || attempt < 0) return null;
	const delay = PLUGGY_RETRY_DELAYS_MS[attempt];
	if (delay !== undefined) return { attempt: attempt + 1, delayMs: delay };
	if (attempt > PLUGGY_RETRY_DELAYS_MS.length) return null;
	// Última: depois da atualização que o Pluggy anunciou (a mais próxima entre as conexões que esperam).
	const times = waiting
		.map((w) => (w.notBefore ? Date.parse(w.notBefore) : Number.NaN))
		.filter((t) => Number.isFinite(t) && t > now.getTime());
	if (times.length === 0) return null;
	return { attempt: attempt + 1, delayMs: Math.min(...times) - now.getTime() + PLUGGY_RETRY_AFTER_UPDATE_MS };
}

/** O `jobId` de cada tentativa: pedidos repetidos da mesma tentativa viram um só. */
export const pluggyRetryJobId = (attempt: number): string => `${PLUGGY_RETRY_JOB}-${attempt}`;

/** Número da tentativa guardado no job (`0` para o diário e o do app, ou dado estranho). */
export function retryAttemptOf(jobName: string, data: unknown): number {
	if (jobName !== PLUGGY_RETRY_JOB) return 0;
	const attempt = (data as { attempt?: unknown } | null)?.attempt;
	return typeof attempt === "number" && Number.isInteger(attempt) && attempt > 0 ? attempt : 0;
}
