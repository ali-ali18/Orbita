/** O que uma importação fez (também é o que o app mostra). */
export interface ImportSummary {
	/** Lançamentos pendentes criados. */
	created: number;
	/** Já existiam (mesmo identificador externo): ignorados. */
	duplicates: number;
	/** Mesma data, valor e conta/cartão de algo que já existe: não criados (ou criados, se o dono pediu). */
	possibleDuplicates: number;
	/** Linhas que o parser não entendeu. */
	unrecognized: number;
}

export interface ImportBatchRecord {
	id: string;
	/** SHA-256 (hex) dos bytes do arquivo. O arquivo em si nunca é guardado. */
	fileHash: string;
	/** `account:<id>` ou `card:<id>`. */
	targetKey: string;
	format: string;
	createdAt: Date;
	/** `null` enquanto a importação ainda roda. */
	summary: ImportSummary | null;
}

export type ImportBegin =
	| { outcome: "started"; id: string }
	/** O mesmo arquivo já foi (ou está sendo) importado para este destino. */
	| { outcome: "existing"; batch: ImportBatchRecord };

/**
 * Registro de arquivos de extrato já importados, para repetir o envio do mesmo arquivo não duplicar nada.
 * Guarda só o hash do arquivo e os números do resultado. A unicidade de (hash, destino) decide quem importa
 * quando dois envios chegam juntos.
 */
export interface ImportBatchStore {
	/**
	 * Reserva (hash, destino) de forma atômica. Uma reserva sem resultado criada antes de `staleBefore` (o
	 * processo caiu no meio) é retomada.
	 */
	begin(input: {
		fileHash: string;
		targetKey: string;
		format: string;
		now: Date;
		staleBefore: Date;
	}): Promise<ImportBegin>;
	/** Guarda o resultado da reserva em andamento. */
	complete(id: string, summary: ImportSummary): Promise<void>;
	/** Desfaz uma reserva sem resultado (a importação falhou), para poder tentar de novo. */
	release(id: string): Promise<void>;
}
