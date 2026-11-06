import type { LocalDate, MonthKey, MonthlyRecurrence } from "@orbita/core";
import type { RecurrenceKindValue } from "@orbita/shared";

/** Os campos que o usuário escolhe. */
export interface RecurrenceData {
	kind: RecurrenceKindValue;
	name: string;
	amountCents: number;
	dayOfMonth: number;
	startDate: LocalDate;
	endDate: LocalDate | null;
	categoryId: string | null;
	accountId: string | null;
	cardId: string | null;
}

export interface RecurrenceRecord extends RecurrenceData {
	id: string;
	archivedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface RecurrenceInput {
	kind: RecurrenceKindValue;
	name: string;
	amountCents: number;
	dayOfMonth: number;
	startDate: LocalDate;
	endDate?: LocalDate | null;
	categoryId?: string | null;
	accountId?: string | null;
	cardId?: string | null;
}

export type RecurrencePatch = Partial<RecurrenceData>;

export interface RecurrencePostingRecord {
	recurrenceId: string;
	month: MonthKey;
	transactionId: string;
}

/** A forma que `dueRecurrences` e companhia esperam (`endDate` ausente, não `null`). */
export function toMonthlyRecurrence(r: RecurrenceRecord): MonthlyRecurrence {
	const base = {
		id: r.id,
		kind: r.kind,
		amountCents: r.amountCents,
		dayOfMonth: r.dayOfMonth,
		startDate: r.startDate,
	};
	return r.endDate === null ? base : { ...base, endDate: r.endDate };
}

export interface RecurrenceStore {
	create(input: RecurrenceInput): Promise<RecurrenceRecord>;
	update(id: string, patch: RecurrencePatch): Promise<RecurrenceRecord>;
	archive(id: string): Promise<RecurrenceRecord>;
	/** Só as ativas, na ordem de criação. */
	list(): Promise<RecurrenceRecord[]>;
	get(id: string): Promise<RecurrenceRecord | null>;
	/** O que já virou lançamento em `month` (alimenta o `PostedRecurrence[]` do engine). */
	listPostings(month: MonthKey): Promise<RecurrencePostingRecord[]>;
	/**
	 * Marca a recorrência como lançada no mês. Uma vez por (recorrência, mês) e um lançamento
	 * só serve a um mês: a segunda chamada é `duplicate`.
	 */
	recordPosting(input: RecurrencePostingRecord): Promise<RecurrencePostingRecord>;
}
