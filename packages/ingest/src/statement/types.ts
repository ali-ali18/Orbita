import type { LocalDate } from "@orbita/core";

/*
 * Extrato (CSV, OFX, PDF). Tudo que vem do arquivo é dado de terceiro: nada daqui vira instrução e o que não bate
 * com segurança vai para `unrecognized`, nunca é adivinhado.
 */

export type StatementFormat = "csv" | "ofx" | "pdf";

/** Uma linha do extrato já normalizada. */
export interface StatementItem {
	date: LocalDate;
	/** Negativo = saída, positivo = entrada. Inteiro, em centavos. */
	amountCents: number;
	description: string;
	/** FITID do OFX (ou coluna de identificador do CSV) quando único no arquivo; senão, hash estável. */
	externalId: string;
}

/** Linha que o parser não conseguiu entender com segurança (texto já saneado e curto). */
export interface UnrecognizedLine {
	/** Número da linha no arquivo (1 = primeira) ou, em PDF, da linha de texto. */
	line: number;
	text: string;
	reason: string;
}

export interface ParsedStatement {
	status: "ok";
	format: StatementFormat;
	items: StatementItem[];
	unrecognized: UnrecognizedLine[];
	/** Avisos em pt-BR para mostrar ao dono. */
	warnings: string[];
	/** Conta que o arquivo declara (OFX), se houver. Só informativa. */
	accountHint: string | null;
}

/** Papel de cada coluna do CSV; os números são posições (0 = primeira coluna). */
export interface CsvMapping {
	delimiter: ";" | "," | "\t";
	/** Linha (0 = primeira) do cabeçalho; `null` = o arquivo não tem cabeçalho. */
	headerRow: number | null;
	date: number;
	/** Uma ou mais colunas, juntadas com " - ". */
	description: number[];
	/** Coluna única com sinal… */
	amount?: number;
	/** …ou colunas separadas de saída e entrada. */
	debit?: number;
	credit?: number;
	/** Coluna de identificador do banco (usada se for única no arquivo). */
	externalId?: number;
}

export interface NeedsMapping {
	status: "needs_mapping";
	format: "csv";
	delimiter: CsvMapping["delimiter"];
	headerRow: number | null;
	/** Nomes das colunas (do cabeçalho, ou "Coluna 1"…). */
	columns: string[];
	/** Algumas linhas de exemplo (células curtas), para o dono reconhecer as colunas. */
	sample: string[][];
	/** O que deu para deduzir; o app pré-seleciona isto. */
	suggested: Partial<Pick<CsvMapping, "date" | "description" | "amount" | "debit" | "credit" | "externalId">>;
	reason: string;
}

export type StatementResult = ParsedStatement | NeedsMapping;

/**
 * Como ler o sinal dos valores:
 * - `account`: negativo é saída (conta corrente, OFX, PDF de extrato).
 * - `card`: em fatura de cartão o valor positivo é compra (saída); negativo é pagamento/estorno.
 */
export type SignConvention = "account" | "card";

export interface ParseOptions {
	sign?: SignConvention;
	/** Troca o sentido de todos os valores (quando o banco usa o contrário do esperado). */
	invertSign?: boolean;
	/** CSV: colunas escolhidas pelo dono. */
	mapping?: CsvMapping;
	/** PDF: máximo de páginas lidas (padrão 60). */
	pdfPageLimit?: number;
}

export type StatementErrorCode = "empty" | "unsupported" | "encrypted" | "too_large" | "unreadable";

export class StatementError extends Error {
	readonly code: StatementErrorCode;
	constructor(code: StatementErrorCode, message: string) {
		super(message);
		this.name = "StatementError";
		this.code = code;
	}
}
