import { ApiError } from "../../lib/api.ts";
import { errorMessage } from "../../lib/loadable.ts";

/*
 * Lógica pura do "Conectar banco": o app pede uma sessão ao servidor e abre no navegador a página que carrega o
 * Pluggy Connect. Ao voltar para o app, a tela confere se a conexão apareceu. Relógio sempre injetado.
 */

export const CONNECT_BUTTON = "Conectar banco";
export const CONNECT_ANOTHER_BUTTON = "Conectar outro banco";

/** Texto do botão: "Conectar outro banco" quando já existe alguma conexão. */
export const connectButtonLabel = (connectionCount: number): string =>
	connectionCount > 0 ? CONNECT_ANOTHER_BUTTON : CONNECT_BUTTON;

/**
 * Conexões das suas próprias contas no plano gratuito do Meu Pluggy (a API não informa o limite; o valor
 * vem da documentação do plano, citada no README). Se o plano mudar, é só este número.
 */
export const FREE_PLAN_CONNECTION_LIMIT = 5;

export interface ConnectionUsage {
	used: number;
	limit: number;
	/** "4 de 5". */
	label: string;
	/** Quantas conexões ainda cabem (nunca negativo). */
	remaining: number;
	full: boolean;
}

/** Uso do plano gratuito: tudo que existe na lista conta, inclusive conexão desconectada. */
export function connectionUsage(used: number, limit: number = FREE_PLAN_CONNECTION_LIMIT): ConnectionUsage {
	const count = Math.max(0, Math.floor(used));
	return {
		used: count,
		limit,
		label: `${count} de ${limit}`,
		remaining: Math.max(0, limit - count),
		full: count >= limit,
	};
}

export const USAGE_TITLE = "Conexões do plano gratuito";
export const USAGE_FULL_HINT = "Limite atingido. Para conectar outro banco, remova uma conexão antes.";

export interface ConnectStep {
	title: string;
	caption: string;
}

export interface ConnectExplainerText {
	title: string;
	subtitle: string;
	steps: readonly ConnectStep[];
	note: string;
	button: string;
	close: string;
}

const BANK_NAME_MAX = 40;

/** O nome vem de fora (rótulo da conexão): vira texto simples, sem quebra de linha e com tamanho limitado. */
export function explainerBankName(name: string | null | undefined): string | null {
	const clean = (name ?? "").replace(/\s+/g, " ").trim();
	if (clean === "") return null;
	return clean.length > BANK_NAME_MAX ? `${clean.slice(0, BANK_NAME_MAX - 1).trimEnd()}…` : clean;
}

/** "Conectar o <banco>" (Figma 53:1207): o que acontece antes de abrir o Pluggy Connect. Sem nome, fala "seu banco". */
export function connectExplainerText(bankName?: string | null): ConnectExplainerText {
	const bank = explainerBankName(bankName);
	return {
		title: bank ? `Conectar o ${bank}` : "Conectar um banco",
		subtitle: "É rápido e você não passa sua senha para mim.",
		steps: [
			{ title: "Abro o Meu Pluggy", caption: "Ele é autorizado pelo Banco Central no Open Finance" },
			{
				title: bank ? `Você entra no app do ${bank}` : "Você entra no app do seu banco",
				caption: "E autoriza o compartilhamento por 12 meses",
			},
			{ title: "Volta aqui sozinho", caption: "Eu trago cartões e lançamentos dos últimos 12 meses" },
		],
		note: "Só leitura. Não consigo fazer Pix, pagar nem mover dinheiro.",
		button: "Abrir o Meu Pluggy",
		close: "Fechar",
	};
}

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
