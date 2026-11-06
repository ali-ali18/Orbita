import type { CardConfig, ClosingRule } from "@orbita/core";

export interface CardRecord {
	id: string;
	name: string;
	bankCode: string | null;
	last4: string | null;
	closingDay: number;
	dueDay: number;
	closingRule: ClosingRule;
	limitCents: number | null;
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
	/** Atalho para o engine: `invoiceFor(date, (await cards.getConfig(id))!)`. */
	getConfig(id: string): Promise<CardConfig | null>;
}
