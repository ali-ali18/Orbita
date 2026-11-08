import type { RecurrencePostingRecord, RecurrenceRecord } from "@orbita/db";
import type { RecurrenceDto, RecurrencePostingDto } from "@orbita/shared";

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
