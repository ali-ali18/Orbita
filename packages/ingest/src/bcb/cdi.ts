import { CDI_DAILY_MAX_E8, isValidLocalDate, type LocalDate } from "@orbita/core";
import { z } from "zod";

/*
 * CDI diário do Banco Central: série SGS 12 ("Taxa de juros - CDI", % ao dia, dias úteis), API pública sem chave:
 *   https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=dd/MM/aaaa&dataFinal=dd/MM/aaaa
 * Formato esperado: `[{"data":"03/11/2026","valor":"0.055131"}]` (data dd/MM/aaaa, valor em % como TEXTO com ponto).
 *
 * ATENÇÃO: o formato acima vem da documentação pública do SGS e NÃO foi conferido contra uma resposta real (a rede da
 * sessão de desenvolvimento não alcançava api.bcb.gov.br). O parser é estrito de propósito: o que não casa é descartado
 * e contado, nunca "adivinhado". A resposta é dado NÃO confiável: validada com zod, taxa diária só de 0 a 0,2%.
 *
 * O servidor só FAZ a chamada (saída para api.bcb.gov.br:443); não manda nenhum dado do usuário.
 */

export const BCB_CDI_URL = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados";
/** Tempo máximo da chamada e tamanho máximo aceito da resposta (5 anos de CDI diário são ~120 KB). */
export const BCB_TIMEOUT_MS = 20_000;
export const BCB_MAX_BYTES = 2_000_000;

export type CdiFetch = (
	url: string,
	init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{
	ok: boolean;
	status: number;
	text(): Promise<string>;
}>;

export interface CdiSeriesRow {
	day: LocalDate;
	/** Fração diária × 10^8 (0,055131% ao dia = 55131). */
	rateE8: number;
}

export interface CdiSeriesRead {
	rows: CdiSeriesRow[];
	/** Linhas da resposta que não passaram na validação (formato, data, taxa fora de 0 a 0,2%, fora do período). */
	skipped: number;
}

const rowSchema = z.object({ data: z.string(), valor: z.string() });
const bodySchema = z.array(z.unknown());

/** "03/11/2026" para "2026-11-03"; `null` se o formato ou o calendário não conferem. */
export function parseBcbDate(text: string): LocalDate | null {
	const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
	if (!m) return null;
	const day = `${m[3]}-${m[2]}-${m[1]}`;
	return isValidLocalDate(day) ? day : null;
}

export const toBcbDate = (day: LocalDate): string =>
	`${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

/**
 * "0.055131" (% ao dia) para a fração × 10^8 (55131), sem float: % × 10^6. Aceita até 12 casas e arredonda para o
 * mais próximo (metade para cima) além da sexta. `null` se não é um decimal simples ou passa de 0,2% ao dia.
 */
export function parseCdiPercent(text: string): number | null {
	const m = /^(\d{1,3})(?:\.(\d{1,12}))?$/.exec(text.trim());
	if (!m) return null;
	const frac = (m[2] ?? "").padEnd(12, "0");
	const micro = BigInt(m[1] as string) * 1_000_000n + BigInt(frac.slice(0, 6));
	const rounded = frac.charCodeAt(6) >= 53 ? micro + 1n : micro; // '5' = 53
	if (rounded > BigInt(CDI_DAILY_MAX_E8)) return null;
	return Number(rounded);
}

/** Valida o corpo da resposta. Lança se não é uma lista (o BCB devolve um objeto de erro nesse caso). */
export function parseCdiResponse(body: unknown, from: LocalDate, to: LocalDate): CdiSeriesRead {
	const list = bodySchema.safeParse(body);
	if (!list.success) throw new Error("Resposta inesperada do Banco Central (não é uma lista).");
	const byDay = new Map<LocalDate, number>();
	let skipped = 0;
	for (const item of list.data) {
		const row = rowSchema.safeParse(item);
		const day = row.success ? parseBcbDate(row.data.data) : null;
		const rateE8 = row.success ? parseCdiPercent(row.data.valor) : null;
		if (day === null || rateE8 === null || day < from || day > to) {
			skipped++;
			continue;
		}
		byDay.set(day, rateE8);
	}
	const rows = [...byDay]
		.map(([day, rateE8]) => ({ day, rateE8 }))
		.sort((a, b) => a.day.localeCompare(b.day));
	return { rows, skipped };
}

/** Busca o CDI de `from` a `to` (inclusivos). `fetch` injetado; lança erro genérico em falha de rede/HTTP. */
export async function fetchCdiSeries(
	deps: { fetch: CdiFetch },
	from: LocalDate,
	to: LocalDate,
): Promise<CdiSeriesRead> {
	const url = `${BCB_CDI_URL}?formato=json&dataInicial=${toBcbDate(from)}&dataFinal=${toBcbDate(to)}`;
	const res = await deps.fetch(url, {
		signal: AbortSignal.timeout(BCB_TIMEOUT_MS),
		headers: { accept: "application/json" },
	});
	if (!res.ok) throw new Error(`O Banco Central respondeu com erro ${res.status}.`);
	const text = await res.text();
	if (text.length > BCB_MAX_BYTES) throw new Error("Resposta do Banco Central grande demais.");
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		throw new Error("Resposta do Banco Central não é JSON.");
	}
	return parseCdiResponse(body, from, to);
}
