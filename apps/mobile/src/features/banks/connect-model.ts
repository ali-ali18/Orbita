import { ApiError } from "../../lib/api.ts";
import { errorMessage } from "../../lib/loadable.ts";

/*
 * Lógica pura do "Conectar banco": o app pede uma sessão ao servidor e abre no navegador a página que carrega o
 * Pluggy Connect. Ao voltar para o app, a tela confere se a conexão apareceu. Relógio sempre injetado.
 */

export const CONNECT_BUTTON = "Conectar banco";
export const MANUAL_BUTTON = "Já tenho o ID da conexão";
export const CONNECT_OPEN_FAILED = "Não consegui abrir o navegador. Tente de novo.";
export const CONNECT_PENDING_HINT = "Entre no seu banco na página que abriu e depois volte para o app.";

/** A sessão vale 15 min no servidor; depois disso a volta ao app não precisa mais conferir. */
export const CONNECT_WAIT_MS = 15 * 60_000;

/**
 * Endereço completo da página. `path` vem do servidor (`/pluggy/conectar#s=…`); só vale se continuar no mesmo
 * endereço do servidor pareado e em http(s): o token nunca vai para outro host.
 */
export function connectUrl(baseUrl: string, path: string): string | null {
	try {
		const base = new URL(baseUrl);
		if (base.protocol !== "https:" && base.protocol !== "http:") return null;
		if (!path.startsWith("/") || path.startsWith("//")) return null;
		const url = new URL(path, base);
		return url.origin === base.origin ? url.toString() : null;
	} catch {
		return null;
	}
}

/** O botão precisa das chaves cadastradas (sem elas o servidor recusa a sessão). */
export const canConnect = (status: { keysConfigured: boolean }): boolean => status.keysConfigured;

/** Está esperando a pessoa terminar de conectar no navegador? `openedAt` é quando a página foi aberta. */
export function isWaitingForConnect(openedAt: number | null, nowMs: number): boolean {
	return openedAt !== null && nowMs - openedAt < CONNECT_WAIT_MS;
}

/** Voltar ao app: do segundo plano (ou da tela do sistema) para ativo. */
export function returnedToApp(prev: string, next: string): boolean {
	return next === "active" && prev !== "active";
}

/** Uma conexão nova apareceu desde que a página foi aberta. */
export const connectionArrived = (countAtOpen: number, count: number): boolean => count > countAtOpen;

export function connectErrorMessage(error: unknown): string {
	if (error instanceof ApiError && error.code === "sem_chaves") {
		return "Cadastre o Client ID e o Client Secret em Servidor e chaves.";
	}
	return errorMessage(error);
}
