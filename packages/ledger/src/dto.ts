import type { CardRecord, RecurrencePostingRecord, RecurrenceRecord, TransactionRecord } from "@orbita/db";
import type { CardDto, RecurrenceDto, RecurrencePostingDto, TransactionDto } from "@orbita/shared";

export function toTransactionDto(t: TransactionRecord): TransactionDto {
	return {
		id: t.id,
		kind: t.kind,
		amountCents: t.amountCents,
		date: t.date,
		description: t.description,
		categoryId: t.categoryId,
		accountId: t.accountId,
		cardId: t.cardId,
		counterpartAccountId: t.counterpartAccountId,
		refundOfId: t.refundOfId,
		budgetMonth: t.budgetMonth,
		invoiceMonth: t.invoiceMonth,
		installmentGroupId: t.installmentGroupId,
		installmentNumber: t.installmentNumber,
		installmentCount: t.installmentCount,
		status: t.status,
		source: t.source,
		externalId: t.externalId,
		note: t.note,
		sourceCategory: t.sourceCategory,
		merchantName: t.merchantName,
		categoryEditedByOwner: t.categoryEditedByOwner,
		editedByOwner: t.editedByOwner,
		splitGroupId: t.splitGroupId,
		createdAt: t.createdAt.toISOString(),
		updatedAt: t.updatedAt.toISOString(),
	};
}

export function toCardDto(c: CardRecord): CardDto {
	return {
		id: c.id,
		name: c.name,
		bankCode: c.bankCode,
		last4: c.last4,
		closingDay: c.closingDay,
		dueDay: c.dueDay,
		closingRule: c.closingRule,
		limitCents: c.limitCents,
		archivedAt: c.archivedAt?.toISOString() ?? null,
		createdAt: c.createdAt.toISOString(),
		updatedAt: c.updatedAt.toISOString(),
	};
}

export function toRecurrenceDto(r: RecurrenceRecord): RecurrenceDto {
	return {
		id: r.id,
		kind: r.kind,
		name: r.name,
		amountCents: r.amountCents,
		dayOfMonth: r.dayOfMonth,
		startDate: r.startDate,
		endDate: r.endDate,
		categoryId: r.categoryId,
		accountId: r.accountId,
		cardId: r.cardId,
		remindDayBefore: r.remindDayBefore,
		archivedAt: r.archivedAt?.toISOString() ?? null,
		createdAt: r.createdAt.toISOString(),
		updatedAt: r.updatedAt.toISOString(),
	};
}

export const toPostingDto = (p: RecurrencePostingRecord): RecurrencePostingDto => ({
	recurrenceId: p.recurrenceId,
	month: p.month,
	transactionId: p.transactionId,
});
