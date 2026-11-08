import { parseCsv } from "./csv.ts";
import { looksLikeOfx, parseOfx } from "./ofx.ts";
import { parsePdf } from "./pdf.ts";
import { decodeBytes } from "./text.ts";
import { type ParseOptions, StatementError, type StatementFormat, type StatementResult } from "./types.ts";

/** Extensões aceitas e o formato que cada uma promete (o conteúdo é conferido de qualquer jeito). */
export const STATEMENT_EXTENSIONS: Readonly<Record<string, StatementFormat>> = {
	csv: "csv",
	txt: "csv",
	ofx: "ofx",
	qfx: "ofx",
	pdf: "pdf",
};

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/**
 * O formato de verdade, pelo CONTEÚDO (a extensão e o tipo MIME vêm do cliente e não valem como prova):
 * `%PDF-` no começo é PDF; cabeçalho ou tag OFX é OFX; o resto, se a extensão prometeu CSV, é CSV.
 */
export function detectStatementFormat(bytes: Uint8Array, filename: string): StatementFormat {
	if (bytes.length === 0) throw new StatementError("empty", "O arquivo está vazio.");
	const promised = STATEMENT_EXTENSIONS[filename.split(".").pop()?.toLowerCase() ?? ""];
	if (!promised) {
		throw new StatementError("unsupported", "Formato não aceito. Envie um arquivo CSV, OFX ou PDF.");
	}
	if (PDF_MAGIC.every((b, i) => bytes[i] === b)) return "pdf";
	if (promised === "pdf") throw new StatementError("unsupported", "Este arquivo não é um PDF de verdade.");
	if (bytes.includes(0))
		throw new StatementError("unsupported", "Este arquivo não parece um extrato em texto.");
	if (looksLikeOfx(decodeBytes(bytes.subarray(0, 4096)))) return "ofx";
	if (promised === "ofx") throw new StatementError("unsupported", "Este arquivo não é um OFX de verdade.");
	return "csv";
}

/** Lê o extrato, seja qual for o formato. Lança `StatementError` (mensagem em pt-BR, pronta para o dono). */
export async function parseStatement(
	bytes: Uint8Array,
	filename: string,
	options: ParseOptions = {},
): Promise<StatementResult> {
	switch (detectStatementFormat(bytes, filename)) {
		case "pdf":
			return parsePdf(bytes, options);
		case "ofx":
			return parseOfx(bytes, options);
		case "csv":
			return parseCsv(bytes, options);
	}
}
