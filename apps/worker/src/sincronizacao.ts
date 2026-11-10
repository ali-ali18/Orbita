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

/**
 * Liga o nome do job à função pura. Desconhecido lança (o BullMQ marca como falho). A nova tentativa sincroniza só as
 * conexões da lista do `data` (as que esperam o banco); o diário e o pedido do app, todas.
 */
export async function processSyncJob(
	jobName: string,
	deps: SyncPluggyDeps,
	data?: unknown,
): Promise<SyncPluggyResult> {
	if (jobName === PLUGGY_RETRY_JOB) {
		const ids = retryConnectionIdsOf(jobName, data);
		// Job antigo, sem lista: sincroniza todas, como fazia.
		return ids === null ? syncPluggy(deps) : syncPluggy(deps, { connectionIds: ids });
	}
	if (jobName === PLUGGY_DAILY_JOB || jobName === PLUGGY_MANUAL_JOB) return syncPluggy(deps);
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
	connectionId: string;
	/** Número desta nova tentativa (1 = a primeira depois de uma sincronização normal). */
	attempt: number;
	delayMs: number;
}

/**
 * Decide a próxima tentativa de CADA conexão que espera. `attempt` é o número da tentativa que acabou de rodar (0 =
 * sincronização diária ou pedida pelo app). `[]`: nada espera o banco, ou as tentativas acabaram. Função pura: quem
 * agenda é o worker (`schedulePluggyRetries`).
 */
export function planPluggyRetry(result: SyncPluggyResult, attempt: number, now: Date): PluggyRetryPlan[] {
	if (!Number.isInteger(attempt) || attempt < 0) return [];
	const plans: PluggyRetryPlan[] = [];
	for (const c of result.connections) {
		if (!c.retry) continue;
		const delay = PLUGGY_RETRY_DELAYS_MS[attempt];
		if (delay !== undefined) {
			plans.push({ connectionId: c.id, attempt: attempt + 1, delayMs: delay });
			continue;
		}
		if (attempt > PLUGGY_RETRY_DELAYS_MS.length) continue;
		// Última: depois da atualização que o Pluggy anunciou para esta conexão.
		const at = c.retry.notBefore ? Date.parse(c.retry.notBefore) : Number.NaN;
		if (!Number.isFinite(at) || at <= now.getTime()) continue;
		plans.push({
			connectionId: c.id,
			attempt: attempt + 1,
			delayMs: at - now.getTime() + PLUGGY_RETRY_AFTER_UPDATE_MS,
		});
	}
	return plans;
}

/** O `jobId` da tentativa de uma conexão: determinístico, então pedidos repetidos viram um só. */
export const pluggyRetryJobId = (connectionId: string, attempt: number): string =>
	`${PLUGGY_RETRY_JOB}-${connectionId}-${attempt}`;

/** Número da tentativa guardado no job (`0` para o diário e o do app, ou dado estranho). */
export function retryAttemptOf(jobName: string, data: unknown): number {
	if (jobName !== PLUGGY_RETRY_JOB) return 0;
	const attempt = (data as { attempt?: unknown } | null)?.attempt;
	return typeof attempt === "number" && Number.isInteger(attempt) && attempt > 0 ? attempt : 0;
}

/**
 * As conexões que a nova tentativa deve sincronizar. `null`: o job não é de nova tentativa, ou é de uma versão antiga
 * sem lista (quem chama sincroniza todas). Lista com item que não é texto curto vira `[]` (não sincroniza nada).
 */
export function retryConnectionIdsOf(jobName: string, data: unknown): string[] | null {
	if (jobName !== PLUGGY_RETRY_JOB) return null;
	const ids = (data as { connectionIds?: unknown } | null)?.connectionIds;
	if (!Array.isArray(ids)) return null;
	const valid = ids.every((id) => typeof id === "string" && id.length > 0 && id.length <= 100);
	return valid ? (ids as string[]).slice(0, 100) : [];
}

/** O que `schedulePluggyRetries` pede da fila (o BullMQ `Queue` serve). */
export interface PluggyRetryQueue {
	getJob(jobId: string): Promise<unknown>;
	add(
		name: string,
		data: { attempt: number; connectionIds: string[] },
		opts: { jobId: string; delay: number; removeOnComplete: true; removeOnFail: true },
	): Promise<unknown>;
}

/**
 * Agenda a próxima tentativa de cada conexão que espera, sem começar outra cadeia para a que já tem uma pendente
 * (em qualquer tentativa; a tentativa em curso, `attempt`, não conta). Devolve quantas agendou. Falhar em agendar não
 * derruba a sincronização que acabou de rodar.
 */
export async function schedulePluggyRetries(
	queue: PluggyRetryQueue,
	result: SyncPluggyResult,
	attempt: number,
	now: Date,
	log: (line: string) => void = () => {},
): Promise<number> {
	let scheduled = 0;
	for (const plan of planPluggyRetry(result, attempt, now)) {
		try {
			let pending = false;
			for (let n = 1; n <= PLUGGY_RETRY_DELAYS_MS.length + 1 && !pending; n++) {
				if (n === attempt) continue;
				pending = (await queue.getJob(pluggyRetryJobId(plan.connectionId, n))) != null;
			}
			if (pending) continue;
			await queue.add(
				PLUGGY_RETRY_JOB,
				{ attempt: plan.attempt, connectionIds: [plan.connectionId] },
				{
					jobId: pluggyRetryJobId(plan.connectionId, plan.attempt),
					delay: plan.delayMs,
					removeOnComplete: true,
					removeOnFail: true,
				},
			);
			scheduled += 1;
			log(`pluggy: nova tentativa ${plan.attempt} em ${Math.round(plan.delayMs / 60_000)} min`);
		} catch {
			log("pluggy: não deu para agendar a nova tentativa");
		}
	}
	return scheduled;
}
