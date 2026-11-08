import { daysInMonth, formatLocalDate, type LocalDate, parseLocalDate } from "@orbita/core";
import { EXPORT_DATASETS, type ExportDataset, type ExportFormat } from "@orbita/shared";
import { parseBrDate } from "../transactions/new-transaction-model.ts";

/*
 * Lógica pura da tela "Exportar tudo": período, formato e o que entra. Nada de dinheiro aqui; o arquivo é montado
 * pelo servidor (`GET /v1/export`). No CSV só cabe um tipo de dado por arquivo; no JSON cabem todos.
 */

export type PeriodChoice = "month" | "year" | "all" | "custom";

export const PERIOD_LABELS: Record<PeriodChoice, string> = {
	month: "Este mês",
	year: "Este ano",
	all: "Tudo",
	custom: "Escolher datas",
};

export interface DateRange {
	from?: LocalDate;
	to?: LocalDate;
}

/** Último dia do mês de `today` ("2026-11-15" → "2026-11-30"). */
function endOfMonth(today: LocalDate): LocalDate {
	const { year, month } = parseLocalDate(today);
	return formatLocalDate(year, month, daysInMonth(year, month));
}

export type RangeResult = { ok: true; range: DateRange } | { ok: false; message: string };

/** Período escolhido → `from`/`to` (datas de calendário). `custom` lê as duas datas digitadas (DD/MM/AAAA). */
export function periodRange(
	choice: PeriodChoice,
	today: LocalDate,
	custom: { from: string; to: string } = { from: "", to: "" },
): RangeResult {
	if (choice === "all") return { ok: true, range: {} };
	if (choice === "month")
		return { ok: true, range: { from: `${today.slice(0, 7)}-01`, to: endOfMonth(today) } };
	if (choice === "year")
		return { ok: true, range: { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` } };
	const from = parseBrDate(custom.from);
	const to = parseBrDate(custom.to);
	if (!from || !to) return { ok: false, message: "Digite as duas datas no formato DD/MM/AAAA." };
	if (from > to) return { ok: false, message: "A data inicial vem antes da final." };
	return { ok: true, range: { from, to } };
}

export const DATASET_ORDER = EXPORT_DATASETS;

/** CSV guarda um tipo de dado por arquivo: tocar escolhe só aquele. JSON liga e desliga, sempre com ao menos um. */
export function toggleDataset(
	format: ExportFormat,
	selected: readonly ExportDataset[],
	key: ExportDataset,
): ExportDataset[] {
	if (format === "csv") return [key];
	const on = selected.includes(key);
	if (on && selected.length === 1) return [...selected];
	const next = on ? selected.filter((d) => d !== key) : [...selected, key];
	return DATASET_ORDER.filter((d) => next.includes(d));
}

/** Trocar para CSV com vários marcados deixa só o primeiro (o mais importante na ordem fixa). */
export function datasetsForFormat(format: ExportFormat, selected: readonly ExportDataset[]): ExportDataset[] {
	if (format === "json") return [...selected];
	const first = DATASET_ORDER.find((d) => selected.includes(d));
	return [first ?? "transactions"];
}

/** O período só vale para lançamentos: sem eles, as datas ficam de fora do pedido. */
export function exportParams(input: {
	format: ExportFormat;
	include: readonly ExportDataset[];
	range: DateRange;
}): Record<string, string> {
	const params: Record<string, string> = { format: input.format, include: input.include.join(",") };
	if (input.include.includes("transactions")) {
		if (input.range.from) params.from = input.range.from;
		if (input.range.to) params.to = input.range.to;
	}
	return params;
}

/** O servidor manda o nome em `Content-Disposition`; sem ele, um nome simples serve. Só aceita nome seguro. */
export function filenameFrom(header: string | null, fallback: string): string {
	const match = header?.match(/filename="([A-Za-z0-9._-]{1,100})"/);
	return match?.[1] ?? fallback;
}

export const EXPORT_MIME: Record<ExportFormat, string> = {
	csv: "text/csv",
	json: "application/json",
};

export const EXPORT_DONE = "Arquivo pronto. Escolha para onde enviar.";
