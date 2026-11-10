import type { Cents, LocalDate } from "@orbita/core";

/*
 * Investimentos: posição ATUAL, retrato diário e movimentações. Dinheiro em centavos inteiros; quantidade, cota e
 * taxas são decimais em TEXTO canônico (sem notação científica, sem zeros sobrando, até 8 casas): nunca float.
 */

/** Os campos de uma posição, como o sync os normaliza (`InvestmentPosition` em `@orbita/ingest`). */
export interface InvestmentFields {
	connectionId: string | null;
	type: string | null;
	subtype: string | null;
	name: string | null;
	code: string | null;
	isin: string | null;
	currency: string | null;
	/** "ACTIVE", "PENDING", "TOTAL_WITHDRAWAL"… (texto livre da fonte). */
	status: string | null;
	/** Saldo líquido atual. */
	balanceCents: Cents | null;
	/** Valor bruto. */
	grossCents: Cents | null;
	/** Valor aplicado (`amountOriginal`). */
	investedCents: Cents | null;
	/** Rendimento que o BANCO informou; `null` = não informou (o engine deriva, nunca inventa aqui). */
	profitCents: Cents | null;
	withdrawableCents: Cents | null;
	incomeTaxCents: Cents | null;
	financialTaxCents: Cents | null;
	quantity: string | null;
	unitValue: string | null;
	rate: string | null;
	rateType: string | null;
	fixedAnnualRate: string | null;
	annualRate: string | null;
	lastMonthRate: string | null;
	lastTwelveMonthsRate: string | null;
	/** Datas só com o dia (AAAA-MM-DD). */
	positionDate: LocalDate | null;
	dueDate: LocalDate | null;
	issueDate: LocalDate | null;
	purchaseDate: LocalDate | null;
	issuer: string | null;
}

/** Entrada de `upsertPosition`: tudo que não vier é `null` (a posição é regravada por inteiro a cada rodada). */
export type InvestmentInput = { source: string; externalId: string } & Partial<InvestmentFields>;

export interface InvestmentRecord extends InvestmentFields {
	id: string;
	source: string;
	externalId: string;
	/** Última vez que a sincronização viu a posição na lista da fonte. */
	syncedAt: Date;
	/** Sumiu da lista da fonte ou chegou a TOTAL_WITHDRAWAL. A posição NUNCA é apagada. */
	archivedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface InvestmentSnapshotInput {
	/** O dia em America/Sao_Paulo. */
	day: LocalDate;
	/** Obrigatório: sem saldo não há retrato (o store devolve `null` e não grava). */
	balanceCents: Cents | null;
	grossCents?: Cents | null;
	investedCents?: Cents | null;
	quantity?: string | null;
	unitValue?: string | null;
}

export interface InvestmentSnapshotRecord {
	id: string;
	investmentId: string;
	day: LocalDate;
	balanceCents: Cents;
	grossCents: Cents | null;
	investedCents: Cents | null;
	quantity: string | null;
	unitValue: string | null;
	createdAt: Date;
}

export interface InvestmentSnapshotFilter {
	/** Ausente = todas as posições. */
	investmentIds?: readonly string[];
	/** Dias inclusivos. */
	from?: LocalDate;
	to?: LocalDate;
}

export interface InvestmentMovementInput {
	externalId: string;
	type?: string | null;
	movementType?: string | null;
	date?: LocalDate | null;
	tradeDate?: LocalDate | null;
	/** Valor bruto da operação, sem sinal. */
	amountCents?: Cents | null;
	netAmountCents?: Cents | null;
	quantity?: string | null;
	unitValue?: string | null;
	/** Texto do banco: dado, nunca instrução. */
	description?: string | null;
}

export interface InvestmentMovementRecord {
	id: string;
	investmentId: string;
	source: string;
	externalId: string;
	type: string | null;
	movementType: string | null;
	date: LocalDate | null;
	tradeDate: LocalDate | null;
	amountCents: Cents | null;
	netAmountCents: Cents | null;
	quantity: string | null;
	unitValue: string | null;
	description: string | null;
	createdAt: Date;
}

export interface InvestmentMovementFilter {
	investmentIds?: readonly string[];
	/** Pela `date` (a data da operação), inclusivos; movimentação sem data só entra sem filtro de datas. */
	from?: LocalDate;
	to?: LocalDate;
}

export interface InvestmentListFilter {
	connectionId?: string;
	/** Padrão `false`: só as não arquivadas. */
	includeArchived?: boolean;
}

export interface InvestmentStore {
	/**
	 * Grava a posição atual por `(source, externalId)`: cria ou regrava os campos. `syncedAt` = agora. O `archivedAt`
	 * segue a situação: `TOTAL_WITHDRAWAL` arquiva (guardando o primeiro instante) e qualquer outra situação desarquiva
	 * (a posição voltou). Nunca apaga. `wasArchived`: já estava arquivada antes desta chamada.
	 */
	upsertPosition(
		input: InvestmentInput,
	): Promise<{ record: InvestmentRecord; created: boolean; wasArchived: boolean }>;
	/**
	 * Arquiva as posições NÃO arquivadas da conexão que não estão em `presentExternalIds` (sumiram da lista da fonte).
	 * Devolve quantas. Só chamar depois de uma leitura que deu certo: lista que falhou não pode arquivar nada.
	 */
	archiveMissing(
		source: string,
		connectionId: string,
		presentExternalIds: readonly string[],
	): Promise<number>;
	get(id: string): Promise<InvestmentRecord | null>;
	/** Mais antigas primeiro. */
	list(filter?: InvestmentListFilter): Promise<InvestmentRecord[]>;
	/**
	 * Retrato do dia, idempotente por `(investmentId, day)` (refazer no mesmo dia sobrescreve). `null`, sem gravar, se
	 * `balanceCents` é nulo. `not_found` se a posição não existe.
	 */
	upsertSnapshot(
		investmentId: string,
		input: InvestmentSnapshotInput,
	): Promise<InvestmentSnapshotRecord | null>;
	/** Do dia mais antigo para o mais novo. */
	listSnapshots(filter?: InvestmentSnapshotFilter): Promise<InvestmentSnapshotRecord[]>;
	/**
	 * Grava as movimentações da posição por `(source, externalId)`: nova é criada, repetida é regravada (mesma id, o
	 * banco pode corrigir o dado), nada duplica. `not_found` se a posição não existe; `invalid` se a movimentação já
	 * pertence a OUTRA posição.
	 */
	upsertMovements(
		investmentId: string,
		rows: readonly InvestmentMovementInput[],
	): Promise<{ created: number; updated: number }>;
	/** Da mais recente para a mais antiga (data, depois id externo); sem data por último. */
	listMovements(filter?: InvestmentMovementFilter): Promise<InvestmentMovementRecord[]>;
}
