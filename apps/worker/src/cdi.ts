import { addDays, toLocalDate } from "@orbita/core";
import type { Stores } from "@orbita/db";
import { type CdiFetch, fetchCdiSeries } from "@orbita/ingest";

/*
 * Atualização diária do CDI (série SGS 12 do Banco Central). Idempotente: refazer não muda nada que já está certo.
 * `now` e `fetch` entram por parâmetro (nada de relógio nem rede dentro da lógica). Sem variável de ambiente.
 */

export const CDI_QUEUE = "cdi";
export const CDI_UPDATE_JOB = "atualizar-cdi";
/** Todo dia às 08:20 (America/Sao_Paulo): o Banco Central já publicou o CDI do dia útil anterior. */
export const CDI_UPDATE_PATTERN = "20 8 * * *";
export const CDI_UPDATE_TIME_ZONE = "America/Sao_Paulo";
/** Primeira carga (série vazia): quantos anos para trás. A API do Banco Central limita consultas diárias a 10 anos. */
export const CDI_BACKFILL_YEARS = 5;
/** Quando já há série, relê esta janela (dias) para pegar correções e dias que faltaram. */
export const CDI_REREAD_DAYS = 15;

export interface CdiUpdateResult {
	from: string;
	to: string;
	created: number;
	updated: number;
	skipped: number;
}

export async function updateCdiRates(deps: {
	stores: Pick<Stores, "cdiRates">;
	fetch: CdiFetch;
	now: () => Date;
	log?: (line: string) => void;
}): Promise<CdiUpdateResult> {
	const today = toLocalDate(deps.now());
	const latest = await deps.stores.cdiRates.latest();
	const from = latest ? addDays(latest.day, -CDI_REREAD_DAYS) : addDays(today, -365 * CDI_BACKFILL_YEARS);
	const read = await fetchCdiSeries({ fetch: deps.fetch }, from, today);
	if (read.skipped > 0)
		deps.log?.(`[${CDI_UPDATE_JOB}] ${read.skipped} linha(s) do Banco Central descartada(s)`);
	const { created, updated } = await deps.stores.cdiRates.upsertMany(read.rows);
	return { from, to: today, created, updated, skipped: read.skipped };
}
