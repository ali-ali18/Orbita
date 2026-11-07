import type { PluggyConnectionRecord } from "@orbita/db";
import type { PluggyConnectionDto } from "@orbita/shared";

/** Só estado e mensagem sanitizada; nada de chave. */
export function toPluggyConnectionDto(c: PluggyConnectionRecord): PluggyConnectionDto {
	return {
		id: c.id,
		label: c.label,
		createdAt: c.createdAt.toISOString(),
		lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
		lastStatus: c.lastStatus,
		lastError: c.lastError,
		summary: { accounts: c.accountCount, cards: c.cardCount },
	};
}
