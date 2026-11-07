import { PLUGGY_LABEL_MAX, PLUGGY_SYNC_STATUSES } from "@orbita/shared";
import { invalid } from "./errors.ts";
import type { PluggyConnectionInput, PluggySyncResult } from "./pluggy-connection-store.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const LAST_ERROR_MAX = 500;

/** Mesma regra nos dois stores (Prisma e memória). O id é guardado em minúsculo. */
export function normalizeConnection(input: PluggyConnectionInput) {
	const id = typeof input.id === "string" ? input.id.trim().toLowerCase() : "";
	if (!UUID.test(id)) throw invalid("O ID da conexão do Pluggy deve ser um UUID.");
	let label: string | null = null;
	if (input.label !== undefined && input.label !== null) {
		label = typeof input.label === "string" ? input.label.trim() : "";
		if (label.length === 0) throw invalid("Informe um nome.");
		if (label.length > PLUGGY_LABEL_MAX) throw invalid(`O nome passa de ${PLUGGY_LABEL_MAX} letras.`);
	}
	return { id, label };
}

export function normalizeSyncResult(result: PluggySyncResult) {
	if (!PLUGGY_SYNC_STATUSES.includes(result.status)) throw invalid("Situação da sincronização inválida.");
	const error = result.error?.trim() ? result.error.trim().slice(0, LAST_ERROR_MAX) : null;
	return {
		status: result.status,
		error,
		syncedAt: result.status === "ok" ? (result.syncedAt ?? null) : null,
	};
}
