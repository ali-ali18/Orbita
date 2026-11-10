import type { Cents, InvestmentRateKind, LocalDate, TermSource } from "@orbita/core";

/*
 * Condições de um investimento informadas pelo dono (taxa contratada, valor aplicado, data da aplicação). Vive numa
 * tabela PRÓPRIA: o sync do banco regrava `investments` por inteiro a cada rodada e apagaria estes dados. Taxa em
 * centésimos de ponto percentual (102% do CDI = 10200), nunca decimal. Cada campo tem a sua origem.
 */

export interface InvestmentTermsRecord {
	investmentId: string;
	rateKind: InvestmentRateKind | null;
	rateBps: number | null;
	rateSource: TermSource | null;
	investedCents: Cents | null;
	investedSource: TermSource | null;
	startDate: LocalDate | null;
	startDateSource: TermSource | null;
	createdAt: Date;
	updatedAt: Date;
}

/** Campo ausente ou `null` = não informado. `source` (padrão USER) vale para todos os campos informados. */
export interface InvestmentTermsInput {
	rateKind?: InvestmentRateKind | null;
	rateBps?: number | null;
	investedCents?: Cents | null;
	startDate?: LocalDate | null;
	source?: TermSource;
}

export interface InvestmentTermsStore {
	/**
	 * SUBSTITUI as condições da posição. Tudo ausente ou `null` apaga a linha e devolve `null`. `not_found` se a posição
	 * não existe; `invalid` (mensagem pt-BR) para taxa fora dos limites do tipo, tipo sem taxa (ou taxa sem tipo), valor
	 * aplicado que não é inteiro positivo, data inválida.
	 */
	put(investmentId: string, input: InvestmentTermsInput): Promise<InvestmentTermsRecord | null>;
	get(investmentId: string): Promise<InvestmentTermsRecord | null>;
	/** Todas as posições com condições informadas, pela posição. */
	list(): Promise<InvestmentTermsRecord[]>;
}
