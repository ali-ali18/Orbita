import type { CsvMappingBody, ImportNeedsMapping, ImportPreviewReady } from "@orbita/shared";
import { IMPORT_EXTENSIONS, IMPORT_MAX_BYTES } from "@orbita/shared";
import { dayMonth } from "../../lib/format.ts";

/** Regras e textos da importação de extrato. Funções puras: a tela só liga isto aos componentes. */

export type ImportTarget = { kind: "account" | "card"; id: string };

/** Confere o arquivo escolhido antes de enviar (o servidor confere de novo). `null` = pode enviar. */
export function fileProblem(file: { name: string; size?: number | null | undefined }): string | null {
	const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
	if (!(IMPORT_EXTENSIONS as readonly string[]).includes(ext)) {
		return "Formato não aceito. Escolha um arquivo CSV, OFX ou PDF.";
	}
	if (typeof file.size === "number" && file.size > IMPORT_MAX_BYTES) return "O arquivo passa de 5 MB.";
	if (file.size === 0) return "O arquivo está vazio.";
	return null;
}

export function periodLabel(period: { from: string; to: string } | null): string {
	if (!period) return "—";
	return period.from === period.to
		? dayMonth(period.from)
		: `${dayMonth(period.from)} a ${dayMonth(period.to)}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function previewHeadline(p: ImportPreviewReady): string {
	if (p.toCreate === 0) return "Nada novo neste arquivo.";
	return `${plural(p.toCreate, "lançamento novo", "lançamentos novos")} para revisar.`;
}

/** Linhas de aviso sobre o que não entra, na ordem em que importam ao dono. */
export function previewNotes(p: ImportPreviewReady): string[] {
	const notes: string[] = [];
	if (p.duplicates > 0)
		notes.push(`${plural(p.duplicates, "já estava", "já estavam")} no Órbita e fica de fora.`);
	if (p.possibleDuplicates > 0) {
		notes.push(
			`${plural(p.possibleDuplicates, "parece repetir", "parecem repetir")} um lançamento do mesmo dia e valor.`,
		);
	}
	if (p.creditsSkipped > 0) {
		notes.push(`${plural(p.creditsSkipped, "entrada do cartão", "entradas do cartão")} não é importada.`);
	}
	if (p.unrecognizedTotal > 0) {
		notes.push(`${plural(p.unrecognizedTotal, "linha não entendida", "linhas não entendidas")}.`);
	}
	return [...notes, ...p.warnings];
}

export function importedMessage(summary: {
	created: number;
	duplicates: number;
	unrecognized: number;
}): string {
	if (summary.created === 0) return "Nenhum lançamento novo entrou.";
	return `${plural(summary.created, "lançamento foi para", "lançamentos foram para")} Para revisar.`;
}

// ------------------------------------------------------------- mapeamento

export interface MappingChoice {
	date: number | null;
	description: number | null;
	/** "amount": uma coluna com sinal. "split": saída e entrada separadas. */
	mode: "amount" | "split";
	amount: number | null;
	debit: number | null;
	credit: number | null;
}

export function initialChoice(need: ImportNeedsMapping): MappingChoice {
	const s = need.suggested;
	const split = s.amount === undefined && s.debit !== undefined && s.credit !== undefined;
	return {
		date: s.date ?? null,
		description: s.description?.[0] ?? null,
		mode: split ? "split" : "amount",
		amount: s.amount ?? null,
		debit: s.debit ?? null,
		credit: s.credit ?? null,
	};
}

/** Escolha do dono -> corpo do pedido. `null` enquanto faltar algo (o botão fica desligado). */
export function buildMapping(need: ImportNeedsMapping, c: MappingChoice): CsvMappingBody | null {
	if (c.date === null || c.description === null) return null;
	if (c.mode === "amount" ? c.amount === null : c.debit === null || c.credit === null) return null;
	const picked = c.mode === "amount" ? [c.amount] : [c.debit, c.credit];
	if (new Set([c.date, c.description, ...picked]).size !== 2 + picked.length) return null;
	return {
		delimiter: need.delimiter,
		headerRow: need.headerRow,
		date: c.date,
		description: [c.description],
		...(c.mode === "amount"
			? { amount: c.amount as number }
			: { debit: c.debit as number, credit: c.credit as number }),
		// O identificador do banco (se o app reconheceu) continua valendo.
		...(need.suggested.externalId === undefined ? {} : { externalId: need.suggested.externalId }),
	};
}

export function targetFields(target: ImportTarget): Record<string, string> {
	return target.kind === "account" ? { accountId: target.id } : { cardId: target.id };
}
