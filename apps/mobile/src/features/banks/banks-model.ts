import { toLocalDate } from "@orbita/core";
import {
	needsReconnect,
	PLUGGY_LABEL_MAX,
	type PluggyConnectionDto,
	type PluggyStatusResponse,
	pluggyConnectionCreateBody,
	pluggyLabelSchema,
	pluggyWaitingFor,
} from "@orbita/shared";
import { banks } from "@orbita/tokens";
import { ApiError } from "../../lib/api.ts";
import { dayMonth } from "../../lib/format.ts";
import { errorMessage } from "../../lib/loadable.ts";

/*
 * Lógica pura da tela "Bancos e cartões" (Meu Pluggy). Relógio sempre injetado: nada de `new Date()` aqui.
 */

export type SyncState = PluggyStatusResponse["sync"];

export const PLUGGY_URL = "https://meu.pluggy.ai";
export const ADD_HINT = "Se você já tem o ID de uma conexão do Meu Pluggy, cole aqui.";
export const KEYS_MISSING_TITLE = "Faltam as chaves do Meu Pluggy";
export const KEYS_MISSING_MESSAGE =
	"Sem o Client ID e o Client Secret o servidor não consegue buscar nada no Pluggy.";
export const EMPTY_TITLE = "Nenhum banco conectado";
export const EMPTY_MESSAGE = "Toque em Conectar banco para entrar no seu banco pelo Pluggy.";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "agora", "há 5 min", "há 2 h", "há 3 d"; `null` se o texto não é uma data. Data futura (relógio atrasado) vale "agora". */
export function formatAgo(iso: string, now: Date): string | null {
	const at = new Date(iso).getTime();
	if (Number.isNaN(at)) return null;
	const diff = Math.max(0, now.getTime() - at);
	if (diff < MINUTE) return "agora";
	if (diff < HOUR) return `há ${Math.floor(diff / MINUTE)} min`;
	if (diff < DAY) return `há ${Math.floor(diff / HOUR)} h`;
	return `há ${Math.floor(diff / DAY)} d`;
}

export const UNNAMED_CONNECTION = "Banco novo";

/**
 * Nome da conexão. "MeuPluggy" é o nome do conector, igual em todas (não diz o banco): enquanto o servidor não
 * descobre o banco pelas contas, a conexão aparece como "Banco novo" e a legenda diz o que falta.
 */
export function connectionName(c: Pick<PluggyConnectionDto, "label">): string {
	const label = c.label?.trim() ?? "";
	return label === "" || /^meu\s*pluggy$/i.test(label) ? UNNAMED_CONNECTION : label;
}

export const UPDATING_LINE = "Atualizando no banco…";
export const NO_ACCOUNTS_LINE = "Conectado, mas o banco ainda não enviou contas";

/**
 * A conexão espera o banco? "updating": o item do Pluggy ainda atualiza. "no_accounts": sem conta nem cartão, seja
 * porque o servidor avisou, seja porque gravou "ok" com a lista vazia (servidor antigo): "Sincronizado" aí engana.
 * Quem já tem contas e veio vazio desta vez não entra: cai em "Sincronizou em parte".
 */
function waitingKind(c: PluggyConnectionDto): "updating" | "no_accounts" | null {
	const waiting = pluggyWaitingFor(c);
	if (waiting === "updating") return "updating";
	const empty = c.summary.accounts + c.summary.cards === 0;
	return empty && (waiting === "no_accounts" || c.lastStatus === "ok") ? "no_accounts" : null;
}

/** "Sincronizado agora" / "Sincronizado há 2 h". */
function syncedAt(iso: string | null, now: Date): string | null {
	const ago = iso ? formatAgo(iso, now) : null;
	if (!ago) return null;
	return ago === "agora" ? "Sincronizado agora" : `Sincronizado ${ago}`;
}

/**
 * Situação da última sincronização da conexão, em uma linha. `lastSyncAt` só avança quando a conexão
 * termina bem: em "parcial" e "erro" ele diz quando o dado foi bom pela última vez.
 */
export function connectionStatusLine(c: PluggyConnectionDto, now: Date): string {
	const good = syncedAt(c.lastSyncAt, now);
	const ago = c.lastSyncAt ? formatAgo(c.lastSyncAt, now) : null;
	const lastOk = ago ? ` · último ok ${ago}` : "";
	if (needsReconnect(c)) return `Desconectado${lastOk}`;
	const waiting = waitingKind(c);
	if (waiting === "updating") return UPDATING_LINE;
	if (waiting === "no_accounts") return NO_ACCOUNTS_LINE;
	switch (c.lastStatus) {
		case "ok":
			return good ?? "Sincronizado";
		case "partial":
			return `Sincronizou em parte${lastOk}`;
		case "error": {
			const reason = c.lastError?.trim() || "a última sincronização falhou";
			return `Erro: ${reason}${lastOk}`;
		}
		case "no_keys":
			return "Sem chaves do Pluggy";
		case null:
			return "Nunca sincronizou";
	}
}

/** Explicação da situação "esperando o banco", para a gaveta da conexão; `null` nas outras situações. */
export function connectionStatusDetail(c: PluggyConnectionDto): string | null {
	const waiting = waitingKind(c);
	if (waiting === "updating") {
		return "O Pluggy ainda está buscando os dados neste banco. O Órbita tenta de novo sozinho em alguns minutos.";
	}
	if (waiting === "no_accounts") {
		return "O Pluggy confirma a conexão, mas ainda não entregou nenhuma conta nem cartão deste banco. O Órbita tenta de novo sozinho; se amanhã continuar assim, confira no Meu Pluggy se o banco aparece atualizado por lá.";
	}
	return null;
}

/** "1 conta", "2 contas · 1 cartão"; `null` se a conexão ainda não trouxe nada. */
export function connectionSummaryText(summary: PluggyConnectionDto["summary"]): string | null {
	const parts: string[] = [];
	if (summary.accounts > 0) parts.push(`${summary.accounts} ${summary.accounts === 1 ? "conta" : "contas"}`);
	if (summary.cards > 0) parts.push(`${summary.cards} ${summary.cards === 1 ? "cartão" : "cartões"}`);
	return parts.length > 0 ? parts.join(" · ") : null;
}

/** Legenda da linha: "1 conta · 1 cartão · Sincronizado agora" (sem resumo, só a situação). */
export function connectionCaption(c: PluggyConnectionDto, now: Date): string {
	const summary = connectionSummaryText(c.summary);
	const status = connectionStatusLine(c, now);
	return summary ? `${summary} · ${status}` : status;
}

export type ValidatedLabel = { ok: true; label: string } | { ok: false; message: string };

/** Valida o novo nome com o mesmo schema do servidor. */
export function parseRenameInput(text: string): ValidatedLabel {
	const parsed = pluggyLabelSchema.safeParse(text);
	if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Nome inválido." };
	return { ok: true, label: parsed.data };
}

/**
 * Quando a única coisa que falta é o banco de uma conexão nova: "Sincronizado agora · 1 conexão esperando o banco".
 * As demais contam pela sincronização boa mais antiga. `null` se alguma conexão está sem sincronizar por outro motivo.
 */
function waitingCaption(connections: readonly PluggyConnectionDto[], now: Date): string | null {
	const pending = connections.filter((c) => c.lastSyncAt === null);
	const synced = connections.flatMap((c) => (c.lastSyncAt === null ? [] : [c.lastSyncAt]));
	if (pending.length === 0 || synced.length === 0 || pending.some((c) => waitingKind(c) === null))
		return null;
	const good = syncedAt([...synced].sort()[0] ?? null, now);
	if (good === null) return null;
	return `${good} · ${pending.length === 1 ? "1 conexão esperando" : `${pending.length} conexões esperando`} o banco`;
}

/** Título e legenda do cartão de sincronização do topo. */
export function syncCardText(
	status: Pick<PluggyStatusResponse, "sync" | "lastSyncAt"> & {
		connections?: readonly PluggyConnectionDto[];
	},
	now: Date,
	slow = false,
): { title: string; caption: string } {
	switch (status.sync) {
		case "queued":
			return {
				title: "Na fila",
				caption: slow ? SLOW_SYNC_CAPTION : "O servidor começa a sincronizar em instantes.",
			};
		case "running":
			return {
				title: "Sincronizando…",
				caption: slow ? SLOW_SYNC_CAPTION : "Isso pode levar alguns minutos.",
			};
		case "unavailable":
			return {
				title: "Sincronização indisponível",
				caption: "A fila de sincronização não está ligada neste servidor.",
			};
		case "idle":
			return {
				title: "Última sincronização",
				caption:
					syncedAt(status.lastSyncAt, now) ??
					waitingCaption(status.connections ?? [], now) ??
					"Alguma conexão ainda não sincronizou.",
			};
	}
}

export const isSyncActive = (sync: SyncState | undefined): boolean => sync === "queued" || sync === "running";

export function syncButtonLabel(sync: SyncState): string {
	if (sync === "queued") return "Na fila…";
	if (sync === "running") return "Sincronizando…";
	return "Sincronizar agora";
}

/** O botão só vale com chaves, ao menos uma conexão, fila ligada e nada em andamento. */
export function canSync(status: PluggyStatusResponse): boolean {
	return status.keysConfigured && status.connections.length > 0 && status.sync === "idle";
}

export const POLL_EVERY_MS = 3_000;
/** Depois de 5 min o polling desacelera (não para): a sincronização pode mesmo demorar. */
export const POLL_SLOW_AFTER_MS = 5 * 60_000;
export const POLL_SLOW_EVERY_MS = 30_000;
export const SLOW_SYNC_CAPTION =
	"Ainda sincronizando. Pode sair desta tela: o Início atualiza sozinho quando terminar.";

/** Próximo intervalo de atualização do status: 3 s no começo, 30 s depois de 5 min; `false` quando nada roda. */
export function nextPollDelay(sync: SyncState | undefined, elapsedMs: number): number | false {
	if (!isSyncActive(sync)) return false;
	return elapsedMs < POLL_SLOW_AFTER_MS ? POLL_EVERY_MS : POLL_SLOW_EVERY_MS;
}

/** `sinceMs` é quando a sincronização em andamento foi vista pela primeira vez (`null` = nada em andamento). */
export function isSlowSync(sinceMs: number | null, nowMs: number): boolean {
	return sinceMs !== null && nowMs - sinceMs >= POLL_SLOW_AFTER_MS;
}

/** Aviso para leitor de tela, só na troca de estado (nunca no "há N min", que muda sozinho). */
export function syncAnnouncement(prev: SyncState | undefined, next: PluggyStatusResponse): string | null {
	if (prev === next.sync) return null;
	if (next.sync === "queued") return "Sincronização na fila.";
	if (next.sync === "running") return "Sincronizando.";
	if (next.sync === "idle" && isSyncActive(prev)) {
		const failed =
			next.connections.length > 0 &&
			next.connections.every((c) => c.lastStatus === "error" || c.lastStatus === "no_keys");
		return failed ? "A sincronização terminou com erro." : "Sincronização concluída.";
	}
	return null;
}

/**
 * Assinatura do que a última sincronização trouxe: id, quando e como terminou cada conexão. Muda
 * quando uma sincronização (a do botão ou a diária) termina, esteja o app onde estiver.
 */
export function syncSignature(status: Pick<PluggyStatusResponse, "connections">): string {
	return [...status.connections]
		.sort((a, b) => a.id.localeCompare(b.id))
		.map((c) => `${c.id}|${c.lastSyncAt ?? ""}|${c.lastStatus ?? ""}`)
		.join(";");
}

/**
 * Decide se o Início está desatualizado. `seen` é a assinatura da última vez que o Início foi tratado
 * (guardada no QueryClient, não numa tela). Sem `seen` (primeira vez) só registra. Com sincronização
 * em andamento espera. Mudou e algum banco trouxe dado (ok ou parcial): recarrega.
 */
export function homeRefreshDecision(
	seen: string | undefined,
	status: PluggyStatusResponse,
): { reload: boolean; seen: string | undefined } {
	if (isSyncActive(status.sync)) return { reload: false, seen };
	const now = syncSignature(status);
	if (seen === undefined) return { reload: false, seen: now };
	if (seen === now) return { reload: false, seen };
	const brought = status.connections.some((c) => c.lastStatus === "ok" || c.lastStatus === "partial");
	return { reload: brought, seen: now };
}

/** Consultas do Início que mudam com uma sincronização (a chave é `[baseUrl, assunto, …]`). */
const HOME_QUERIES: ReadonlySet<unknown> = new Set([
	"summary",
	"transactions",
	"accounts",
	"cards",
	"invoice",
	"installments",
]);

export const isHomeQuery = (queryKey: readonly unknown[], baseUrl: string): boolean =>
	queryKey[0] === baseUrl && HOME_QUERIES.has(queryKey[1]);

/** Cor do círculo pelo nome do banco (o Pluggy não manda o código do banco); desconhecido usa o genérico. */
export function bankColorByName(name: string): string {
	const n = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
	if (n.includes("nubank") || n.includes("nu pagamentos")) return banks.nubank;
	if (n.includes("mercado pago")) return banks.mercadoPago;
	if (n.includes("santander")) return banks.santander;
	if (n.includes("picpay")) return banks.picpay;
	if (n.includes("bradesco")) return banks.bradesco;
	if (n.includes("itau")) return banks.itau;
	if (n.includes("inter")) return banks.inter;
	if (/\bc6(\s?bank)?\b/.test(n)) return banks.c6;
	return banks.generic;
}

export { PLUGGY_LABEL_MAX };

/** Mensagem em pt-BR para o erro de cadastrar a conexão. */
export function addErrorMessage(error: unknown): string {
	if (error instanceof ApiError) {
		if (error.status === 409 || error.code === "conflito") return "Esta conexão já está cadastrada.";
		if (error.code === "conexao_invalida")
			return "Não achei essa conexão no seu Meu Pluggy. Confira o ID e se ela é da mesma conta das chaves.";
	}
	return errorMessage(error);
}

export function syncErrorMessage(error: unknown): string {
	if (error instanceof ApiError) {
		if (error.code === "sem_chaves") return "Cadastre o Client ID e o Client Secret em Servidor e chaves.";
		if (error.code === "sem_conexoes") return "Adicione uma conexão antes de sincronizar.";
		if (error.code === "fila_indisponivel") return "A fila de sincronização não está ligada neste servidor.";
	}
	return errorMessage(error);
}

export const REIMPORT_BUTTON = "Reimportar do zero";
export const REIMPORT_TITLE = "Reimportar do zero?";
export const REIMPORT_WARNING =
	"Apaga só o que veio do Meu Pluggy (lançamentos importados) e busca tudo de novo. O que você lançou à mão, as contas e os cartões ficam como estão. Os lançamentos que você tinha apagado voltam.";

/** Mensagem de erro de "Reimportar do zero". */
export function reimportErrorMessage(error: unknown): string {
	if (error instanceof ApiError && error.code === "sincronizando") {
		return "Há uma sincronização em andamento. Tente de novo quando ela terminar.";
	}
	return syncErrorMessage(error);
}

export type ValidatedConnection =
	| { ok: true; itemId: string; label?: string }
	| { ok: false; message: string };

/** Valida o ID (UUID, minúsculo) e o nome opcional com o mesmo schema do servidor. */
export function parseConnectionInput(itemId: string, label: string): ValidatedConnection {
	const trimmed = label.trim();
	const parsed = pluggyConnectionCreateBody.safeParse({ itemId, ...(trimmed ? { label: trimmed } : {}) });
	if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Dado inválido." };
	return {
		ok: true,
		itemId: parsed.data.itemId,
		...(parsed.data.label ? { label: parsed.data.label } : {}),
	};
}

/**
 * Conexões em que o banco pediu login de novo (Figma 55:1204). "Reconectar" atualiza o MESMO item no Pluggy
 * (modo de atualização do Connect). Se mesmo assim chegou uma conexão nova do mesmo banco (a antiga é arquivada
 * pelo servidor) e ela sincroniza bem, a velha não precisa mais do aviso.
 */
export function disconnectedConnections(connections: readonly PluggyConnectionDto[]): PluggyConnectionDto[] {
	const sameName = (a: PluggyConnectionDto, b: PluggyConnectionDto) =>
		connectionName(a).toLowerCase() === connectionName(b).toLowerCase();
	return connections.filter(
		(c) =>
			needsReconnect(c) &&
			!connections.some(
				(o) => o.id !== c.id && sameName(o, c) && (o.lastStatus === "ok" || o.lastStatus === "partial"),
			),
	);
}

export interface ReconnectBannerText {
	title: string;
	caption: string;
	body: string;
	button: string;
}

/** Texto do aviso "O Santander desconectou". `lastSyncAt` diz até quando o dado é bom. */
export function reconnectBannerText(c: PluggyConnectionDto, now: Date): ReconnectBannerText {
	const name = connectionName(c);
	const ago = c.lastSyncAt ? formatAgo(c.lastSyncAt, now) : null;
	const since = c.lastSyncAt ? dayMonth(toLocalDate(new Date(c.lastSyncAt))) : null;
	return {
		title: `O ${name} desconectou`,
		caption: ago ? `Última sincronização ${ago}` : "O banco pediu para você entrar de novo.",
		body: since
			? `Reconecte para eu buscar o que faltou desde ${since}.`
			: "Reconecte para eu buscar seus lançamentos.",
		button: `Reconectar o ${name}`,
	};
}
