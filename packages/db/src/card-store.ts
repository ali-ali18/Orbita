import type { CardConfig, ClosingRule } from "@orbita/core";
import type { TransactionSource } from "@orbita/shared";

export interface CardRecord {
	id: string;
	name: string;
	bankCode: string | null;
	last4: string | null;
	closingDay: number;
	dueDay: number;
	closingRule: ClosingRule;
	limitCents: number | null;
	/** Limite disponível que o banco informou (centavos). `null`: nunca informado. Só a sincronização grava. */
	availableCents: number | null;
	/**
	 * Saldo do cartão que o banco informou (`Account.balance` da conta CREDIT), em centavos. No conector que NÃO é Open
	 * Finance é a fatura aberta ainda não paga (docs.pluggy.ai). `null`: nunca informado. Só a sincronização grava.
	 */
	balanceCents: number | null;
	limitSyncedAt: Date | null;
	/** "manual" ou a origem que criou o cartão (ex.: "pluggy"). */
	source: TransactionSource;
	externalId: string | null;
	archivedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface CardInput {
	name: string;
	bankCode?: string | null;
	last4?: string | null;
	closingDay: number;
	dueDay: number;
	/** Padrão: "closing-day-next". */
	closingRule?: ClosingRule;
	limitCents?: number | null;
	/** Padrão: "manual". Origem diferente de "manual" exige `externalId`. */
	source?: TransactionSource;
	externalId?: string | null;
}

export type CardPatch = Partial<{
	name: string;
	bankCode: string | null;
	last4: string | null;
	closingDay: number;
	dueDay: number;
	closingRule: ClosingRule;
	limitCents: number | null;
}>;

/** A forma que `invoiceFor` e companhia esperam. */
export function toCardConfig(card: Pick<CardRecord, "closingDay" | "dueDay" | "closingRule">): CardConfig {
	return { closingDay: card.closingDay, dueDay: card.dueDay, closingRule: card.closingRule };
}

export interface CardStore {
	create(input: CardInput): Promise<CardRecord>;
	update(id: string, patch: CardPatch): Promise<CardRecord>;
	archive(id: string): Promise<CardRecord>;
	list(): Promise<CardRecord[]>;
	get(id: string): Promise<CardRecord | null>;
	/** O cartão ligado a um cadastro de fora, arquivado ou não. */
	findByExternal(source: TransactionSource, externalId: string): Promise<CardRecord | null>;
	/** Como `AccountStore.relinkExternal`, para cartão: troca só o identificador externo (mesma origem). */
	relinkExternal(id: string, externalId: string): Promise<CardRecord | null>;
	/** Atalho para o engine: `invoiceFor(date, (await cards.getConfig(id))!)`. */
	getConfig(id: string): Promise<CardConfig | null>;
	/**
	 * Grava o limite disponível que o banco informou e o instante da leitura. Não mexe em `updatedAt` (não é edição
	 * do dono). `not_found` se o cartão não existe; `invalid` se `availableCents` não é inteiro de centavos.
	 */
	recordAvailable(
		id: string,
		availableCents: number,
		syncedAt: Date,
		balanceCents?: number | null,
	): Promise<CardRecord>;
}
