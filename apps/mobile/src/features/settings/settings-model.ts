import { toLocalDate } from "@orbita/core";
import { SECRET_LABELS, type SecretName, type SecretStatusDto } from "@orbita/shared";

/*
 * Lógica pura da tela "Servidor e chaves". Regra do dono: nenhum pedaço do valor de uma chave aparece
 * no app (nem mascarado). Aqui só existe o ESTADO da chave; o valor nem chega a este módulo.
 */

export type SecretState = "configured" | "missing" | "repaste";

export function secretState(status: Pick<SecretStatusDto, "configured" | "readable">): SecretState {
	if (!status.configured) return "missing";
	return status.readable ? "configured" : "repaste";
}

const STATE_LABELS: Record<SecretState, string> = {
	configured: "Configurada",
	missing: "Não configurada",
	repaste: "Cole de novo",
};

export function secretStateLabel(status: Pick<SecretStatusDto, "configured" | "readable">): string {
	return STATE_LABELS[secretState(status)];
}

/** Rótulos da lista "Chaves" (o Figma separa o Pluggy em Client ID e Secret). */
export const SECRET_ROW_LABELS: Record<SecretName, string> = {
	anthropic_api_key: "Anthropic (IA)",
	pluggy_client_id: "Meu Pluggy · Client ID",
	pluggy_client_secret: "Meu Pluggy · Secret",
};

const MONTHS_SHORT = [
	"jan",
	"fev",
	"mar",
	"abr",
	"mai",
	"jun",
	"jul",
	"ago",
	"set",
	"out",
	"nov",
	"dez",
] as const;

/** Dia, mês (0..11) e ano no fuso do app (o mesmo do relógio); `null` se o texto não é uma data. */
function calendarParts(iso: string): { day: number; month: string; year: number } | null {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return null;
	const local = toLocalDate(date);
	return {
		day: Number(local.slice(8, 10)),
		month: MONTHS_SHORT[Number(local.slice(5, 7)) - 1] ?? "",
		year: Number(local.slice(0, 4)),
	};
}

/** Ano de uma data de calendário "YYYY-MM-DD" (o `today` do relógio). */
export const yearOf = (today: string): number => Number(today.slice(0, 4));

/** "7 nov"; com o ano ("7 nov 2025") quando não é o ano atual. */
export function formatShortDate(iso: string, currentYear: number): string | null {
	const p = calendarParts(iso);
	if (!p) return null;
	const base = `${p.day} ${p.month}`;
	return p.year === currentYear ? base : `${base} ${p.year}`;
}

/** "Trocada em 7 nov por Galaxy"; `null` quando a chave não tem data (não configurada). */
export function secretCaption(
	status: Pick<SecretStatusDto, "configured" | "updatedAt" | "updatedBy">,
	currentYear: number,
): string | null {
	if (!status.configured || !status.updatedAt) return null;
	const when = formatShortDate(status.updatedAt, currentYear);
	if (!when) return null;
	return status.updatedBy ? `Trocada em ${when} por ${status.updatedBy}` : `Trocada em ${when}`;
}

/** Valor de "Conectado desde": "1 de nov" (o rótulo fica na linha). */
export function formatPairedSince(iso: string, currentYear: number): string {
	const p = calendarParts(iso);
	if (!p) return "—";
	const base = `${p.day} de ${p.month}`;
	return p.year === currentYear ? base : `${base} de ${p.year}`;
}

export function formatResponseTime(ms: number): string {
	return `${Math.max(0, Math.round(ms))} ms`;
}

export function serverStatusLine(version: string, ms: number): string {
	return `Versão ${version} · resposta em ${formatResponseTime(ms)}`;
}

/** Mede quanto uma chamada demora. O relógio é injetado (em produção, `performance.now`). */
export async function timed<T>(run: () => Promise<T>, now: () => number): Promise<{ result: T; ms: number }> {
	const start = now();
	const result = await run();
	return { result, ms: now() - start };
}

/** Texto de ajuda no topo do Sheet de colar a chave. */
export function pasteHint(name: SecretName): string {
	switch (name) {
		case "anthropic_api_key":
			return "Cole a chave da Anthropic. Ela é guardada cifrada no seu servidor e nunca volta para o celular.";
		case "pluggy_client_id":
			return "Cole o Client ID do Pluggy. Ele é guardado cifrado no seu servidor e nunca volta para o celular.";
		case "pluggy_client_secret":
			return "Cole o Client Secret do Pluggy. Ele é guardado cifrado no seu servidor e nunca volta para o celular.";
	}
}

export const removeConfirmTitle = (name: SecretName): string => `Remover a chave ${SECRET_LABELS[name]}?`;
export const removeConfirmMessage = (name: SecretName): string =>
	`O servidor apaga ${SECRET_LABELS[name]}. O que depende dela para de funcionar até você colar uma nova.`;

export const SWITCH_SERVER_TITLE = "Trocar de servidor?";
export const SWITCH_SERVER_MESSAGE =
	"Este aparelho será desconectado do servidor atual. Depois você informa o endereço e o código do novo servidor.";
