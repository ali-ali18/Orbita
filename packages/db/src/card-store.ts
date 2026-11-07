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
	/** Atalho para o engine: `invoiceFor(date, (await cards.getConfig(id))!)`. */
	getConfig(id: string): Promise<CardConfig | null>;
}
