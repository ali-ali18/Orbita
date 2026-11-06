import type { CardRecord } from "@orbita/db";
import type { CardDto } from "@orbita/shared";

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
