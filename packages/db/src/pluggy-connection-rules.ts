import { PLUGGY_LABEL_MAX, PLUGGY_SYNC_STATUSES } from "@orbita/shared";
import { invalid } from "./errors.ts";
import type { PluggyConnectionInput, PluggySyncResult } from "./pluggy-connection-store.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const LAST_ERROR_MAX = 500;

/** Nome de conexão: aparado, 1..60 letras, sem caractere de controle. */
export function normalizeLabel(value: unknown): string {
	const label = typeof value === "string" ? value.trim() : "";
	if (label.length === 0) throw invalid("Informe um nome.");
	if (label.length > PLUGGY_LABEL_MAX) throw invalid(`O nome passa de ${PLUGGY_LABEL_MAX} letras.`);
	if (/\p{Cc}/u.test(label)) throw invalid("O nome tem caracteres que não podem ser usados.");
	return label;
}

/** Mesma regra nos dois stores (Prisma e memória). O id é guardado em minúsculo. */
export function normalizeConnection(input: PluggyConnectionInput) {
	const id = typeof input.id === "string" ? input.id.trim().toLowerCase() : "";
	if (!UUID.test(id)) throw invalid("O ID da conexão do Pluggy deve ser um UUID.");
	const label = input.label !== undefined && input.label !== null ? normalizeLabel(input.label) : null;
	// Nome digitado pelo dono é dele; sem nome, ou sugerido pelo Pluggy, a sincronização pode refinar.
	return { id, label, labelEditedByOwner: input.byOwner === true && label !== null };
}

/** Contagens que vêm da sincronização: inteiros não negativos. */
export function normalizeCounts(counts: { accounts: number; cards: number }) {
	const ok = (n: number) => Number.isInteger(n) && n >= 0 && n <= 10_000;
	if (!ok(counts.accounts) || !ok(counts.cards)) throw invalid("Contagem de contas inválida.");
	return { accountCount: counts.accounts, cardCount: counts.cards };
}

export function normalizeSyncResult(result: PluggySyncResult) {
	if (!PLUGGY_SYNC_STATUSES.includes(result.status)) throw invalid("Situação da sincronização inválida.");
	const error = result.error?.trim() ? result.error.trim().slice(0, LAST_ERROR_MAX) : null;
	return {
		status: result.status,
		error,
		syncedAt: result.status === "ok" ? (result.syncedAt ?? null) : null,
		counts: result.counts ? normalizeCounts(result.counts) : null,
	};
}
