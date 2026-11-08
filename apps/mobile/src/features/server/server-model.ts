import { ApiError } from "../../lib/api.ts";
import type { QueryLike } from "../../lib/loadable.ts";
import { formatAgo } from "../banks/banks-model.ts";

/*
 * Servidor fora do ar (Figma 55:1262). Só vale para "não consegui falar com ele": rede caiu, tempo esgotado ou o
 * proxy sem backend (502/503/504). Erro 4xx e 500 com corpo da API são respostas do servidor, não ausência dele.
 */

export const SERVER_DOWN_TITLE = "Não consigo falar com o seu servidor";
export const SERVER_DOWN_REASONS_TITLE = "O que pode ser";
export const SERVER_DOWN_REASONS = [
	"A VPS está desligada ou sem internet",
	"Os containers pararam (docker compose ps)",
	"O domínio ou o certificado expirou",
] as const;
export const SERVER_DOWN_RETRY = "Tentar de novo";
export const SERVER_DOWN_CHANGE = "Mudar o endereço do servidor";

const GATEWAY_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

/** Erro de consulta que significa "o servidor não respondeu". */
export function isUnreachableError(error: unknown): boolean {
	if (!(error instanceof ApiError)) return false;
	if (error.status === null) return error.code === "sem_conexao";
	return GATEWAY_STATUSES.has(error.status);
}

/**
 * A consulta está sem dado e o motivo é o servidor fora do ar. Com dado em cache a tela segue mostrando o dado;
 * pausada sem rede e sem dado também conta (a consulta nunca terminaria).
 */
export function isUnreachableQuery(
	q: Pick<QueryLike<unknown>, "data" | "error" | "isError" | "isPending" | "fetchStatus">,
): boolean {
	if (q.data !== undefined) return false;
	if (q.isError) return isUnreachableError(q.error);
	return q.isPending && q.fetchStatus === "paused";
}

/** Maior `dataUpdatedAt` entre as consultas com dado (ms); `null` se nenhuma tem. */
export function lastContactAt(
	queries: readonly { dataUpdatedAt: number; hasData: boolean }[],
): number | null {
	let latest: number | null = null;
	for (const q of queries) {
		if (!q.hasData || q.dataUpdatedAt <= 0) continue;
		if (latest === null || q.dataUpdatedAt > latest) latest = q.dataUpdatedAt;
	}
	return latest;
}

/** "financas.exemplo.dev" de "https://financas.exemplo.dev/"; texto que não é endereço volta como veio. */
export function serverHost(baseUrl: string | null): string | null {
	if (!baseUrl) return null;
	try {
		return new URL(baseUrl).host;
	} catch {
		return baseUrl;
	}
}

/** "Último contato há 12 min · financas.exemplo.dev"; cada parte some se não existe. */
export function serverDownCaption(lastContactMs: number | null, baseUrl: string | null, now: Date): string {
	const ago = lastContactMs === null ? null : formatAgo(new Date(lastContactMs).toISOString(), now);
	const parts = [ago ? `Último contato ${ago}` : null, serverHost(baseUrl)].filter(
		(p): p is string => p !== null,
	);
	return parts.join(" · ");
}
