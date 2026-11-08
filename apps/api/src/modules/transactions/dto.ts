import type { TransactionRecord } from "@orbita/db";
import type { TransactionDto } from "@orbita/shared";

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
		splitGroupId: t.splitGroupId,
		createdAt: t.createdAt.toISOString(),
		updatedAt: t.updatedAt.toISOString(),
	};
}
