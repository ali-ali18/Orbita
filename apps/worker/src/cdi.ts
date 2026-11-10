import { addDays, daysBetween, toLocalDate } from "@orbita/core";
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
/**
 * Primeira carga (série vazia): quantos anos para trás. LIMITE CONFIRMADO contra a API real: 8 anos (2007 linhas) passam;
 * uma janela de 10 anos ou mais responde 406. Não aumente sem reler `docs/servidor.md`.
 */
export const CDI_BACKFILL_YEARS = 8;
/** Quando já há série, relê esta janela (dias) para pegar correções e dias que faltaram. */
export const CDI_REREAD_DAYS = 15;

/** Tentativas e espera do job (a rede ou o BCB podem falhar): 3 tentativas, espera exponencial a partir de 1 min. */
export const CDI_JOB_OPTIONS = {
	attempts: 3,
	backoff: { type: "exponential" as const, delay: 60_000 },
	removeOnComplete: true,
	removeOnFail: 50,
};

/** Buraco suspeito: pelo menos este número de dias úteis seguidos sem taxa (feriado é 1 e Carnaval 2; sem calendário). */
const REPAIR_MIN_MISSING_WEEKDAYS = 3;

export interface CdiUpdateResult {
	from: string;
	to: string;
	created: number;
	updated: number;
	skipped: number;
	/** Buracos antigos relidos (faixa do buraco) e quantas linhas essa releitura criou ou corrigiu. */
	repairedHoles: number;
}

const weekdaysBetween = (a: string, b: string): number => {
	let n = 0;
	for (let d = addDays(a, 1); d < b; d = addDays(d, 1)) {
		const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
		if (dow !== 0 && dow !== 6) n++;
	}
	return n;
};

export async function updateCdiRates(deps: {
	stores: Pick<Stores, "cdiRates">;
	fetch: CdiFetch;
	now: () => Date;
	log?: (line: string) => void;
}): Promise<CdiUpdateResult> {
	const today = toLocalDate(deps.now());
	const latest = await deps.stores.cdiRates.latest();
	const backfillFrom = addDays(today, -365 * CDI_BACKFILL_YEARS);
	const from = latest ? addDays(latest.day, -CDI_REREAD_DAYS) : backfillFrom;
	const read = await fetchCdiSeries({ fetch: deps.fetch }, from, today);
	if (read.skipped > 0)
		deps.log?.(`[${CDI_UPDATE_JOB}] ${read.skipped} linha(s) do Banco Central descartada(s)`);
	let { created, updated } = await deps.stores.cdiRates.upsertMany(read.rows);
	let skipped = read.skipped;

	// Buraco antigo na série gravada (fora da janela relida): relê UMA faixa que cobre os buracos e grava o que veio.
	const stored = await deps.stores.cdiRates.list({ from: backfillFrom, to: today });
	const holes: Array<{ after: string; before: string }> = [];
	for (let i = 1; i < stored.length; i++) {
		const a = (stored[i - 1] as { day: string }).day;
		const b = (stored[i] as { day: string }).day;
		if (daysBetween(a, b) > 4 && weekdaysBetween(a, b) >= REPAIR_MIN_MISSING_WEEKDAYS && a < from) {
			holes.push({ after: a, before: b });
		}
	}
	if (holes.length > 0) {
		const repairFrom = (holes[0] as { after: string }).after;
		const repairTo = (holes[holes.length - 1] as { before: string }).before;
		const fix = await fetchCdiSeries({ fetch: deps.fetch }, repairFrom, repairTo);
		const r = await deps.stores.cdiRates.upsertMany(fix.rows);
		created += r.created;
		updated += r.updated;
		skipped += fix.skipped;
		deps.log?.(
			`[${CDI_UPDATE_JOB}] ${holes.length} buraco(s) antigo(s) relido(s): ${r.created} dia(s) preenchido(s)`,
		);
	}
	return { from, to: today, created, updated, skipped, repairedHoles: holes.length };
}
