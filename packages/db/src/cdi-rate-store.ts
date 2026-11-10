import { CDI_DAILY_MAX_E8, type LocalDate } from "@orbita/core";
import { isLocalDate } from "@orbita/shared";
import { invalid } from "./errors.ts";

/*
 * CDI diário (série SGS 12 do Banco Central, % ao dia). O valor é um INTEIRO em escala fixa: `rateE8` = fração diária
 * × 10^8 (0,055131% ao dia = 0,00055131 = 55131), a mesma resolução de 6 casas em % que o Banco Central publica. Dia
 * com linha = dia útil. A fonte é dado externo: o store recusa taxa fora de 0 a 0,2% ao dia e data inexistente.
 */

export interface CdiRateRow {
	day: LocalDate;
	rateE8: number;
}

export interface CdiRateRecord extends CdiRateRow {
	fetchedAt: Date;
}

export interface CdiRateFilter {
	/** Dias inclusivos. */
	from?: LocalDate;
	to?: LocalDate;
}

export interface CdiRateStore {
	/**
	 * Grava as taxas por dia, idempotente: repetir o mesmo dia e valor não muda nada; valor diferente regrava (o Banco Central pode corrigir). Tudo ou nada:
	 * uma linha inválida (`invalid`) desfaz a chamada inteira.
	 */
	upsertMany(rows: readonly CdiRateRow[]): Promise<{ created: number; updated: number }>;
	/** Do dia mais antigo para o mais novo. */
	list(filter?: CdiRateFilter): Promise<CdiRateRecord[]>;
	/** O dia mais recente com taxa; `null` se a série está vazia. */
	latest(): Promise<CdiRateRecord | null>;
}

/** Confere uma linha da série; lança `invalid` (pt-BR) se a taxa ou o dia não são aceitáveis. */
export function checkCdiRow(row: CdiRateRow): CdiRateRow {
	if (!isLocalDate(row.day)) throw invalid("Data do CDI inválida.");
	if (!Number.isSafeInteger(row.rateE8) || row.rateE8 < 0 || row.rateE8 > CDI_DAILY_MAX_E8) {
		throw invalid("Taxa diária do CDI fora do intervalo aceito (0 a 0,2% ao dia).");
	}
	return { day: row.day, rateE8: row.rateE8 };
}
