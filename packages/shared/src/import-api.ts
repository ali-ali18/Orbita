import { z } from "zod";

/*
 * Importar extrato (`POST /v1/imports/preview` e `POST /v1/imports`, multipart). O arquivo vai no campo `file`;
 * os demais campos são texto: `accountId` ou `cardId`, `mapping` (JSON), `invertSign` e `includePossibleDuplicates`.
 */

export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
/** Extensões que o servidor aceita (o conteúdo é conferido de qualquer jeito). */
export const IMPORT_EXTENSIONS = ["csv", "txt", "ofx", "qfx", "pdf"] as const;

const column = z.number().int().min(0).max(200);

/** Colunas do CSV que o dono escolheu. */
export const csvMappingBody = z
	.object({
		delimiter: z.enum([";", ",", "\t"]),
		headerRow: z.number().int().min(0).max(100).nullable(),
		date: column,
		description: z.array(column).min(1).max(4),
		amount: column.optional(),
		debit: column.optional(),
		credit: column.optional(),
		externalId: column.optional(),
	})
	.strict()
	.refine((m) => m.amount !== undefined || (m.debit !== undefined && m.credit !== undefined), {
		message: "Escolha a coluna do valor, ou as de saída e entrada.",
	});
export type CsvMappingBody = z.infer<typeof csvMappingBody>;

export type ImportItemStatus = "new" | "duplicate" | "possible_duplicate";

export interface ImportPreviewItem {
	date: string;
	/** Negativo = saída. */
	amountCents: number;
	description: string;
	status: ImportItemStatus;
}

export interface ImportUnrecognizedLine {
	line: number;
	text: string;
	reason: string;
}

export interface ImportSummaryDto {
	created: number;
	duplicates: number;
	possibleDuplicates: number;
	unrecognized: number;
}

export interface ImportPreviewReady {
	status: "ok";
	format: "csv" | "ofx" | "pdf";
	total: number;
	toCreate: number;
	duplicates: number;
	possibleDuplicates: number;
	creditsSkipped: number;
	period: { from: string; to: string } | null;
	inCents: number;
	outCents: number;
	items: ImportPreviewItem[];
	unrecognized: ImportUnrecognizedLine[];
	unrecognizedTotal: number;
	warnings: string[];
	alreadyImported: ImportSummaryDto | null;
}

/** O CSV não deixou claro qual coluna é qual: o app mostra `columns` e `sample` e o dono escolhe. */
export interface ImportNeedsMapping {
	status: "needs_mapping";
	format: "csv";
	delimiter: ";" | "," | "\t";
	headerRow: number | null;
	columns: string[];
	sample: string[][];
	suggested: {
		date?: number;
		description?: number[];
		amount?: number;
		debit?: number;
		credit?: number;
		externalId?: number;
	};
	reason: string;
}

export type ImportPreviewResponse = ImportPreviewReady | ImportNeedsMapping;

export type ImportResponse =
	| { status: "imported"; summary: ImportSummaryDto & { creditsSkipped: number }; warnings: string[] }
	| { status: "already_imported"; summary: ImportSummaryDto }
	| ImportNeedsMapping;
