import type { AccountRecord } from "@orbita/db";
import type { AccountDto } from "@orbita/shared";

export function toAccountDto(a: AccountRecord): AccountDto {
	return {
		id: a.id,
		name: a.name,
		kind: a.kind,
		bankCode: a.bankCode,
		archivedAt: a.archivedAt?.toISOString() ?? null,
		createdAt: a.createdAt.toISOString(),
		updatedAt: a.updatedAt.toISOString(),
	};
}
