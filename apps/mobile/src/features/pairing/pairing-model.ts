import { PAIRING_CODE_LENGTH } from "@orbita/shared";

export type ServerUrlResult = { ok: true; url: string } | { ok: false; message: string };

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Valida o endereço do servidor e devolve a URL limpa (sem barra no fim, sem caminho).
 * Só https; http é aceito apenas para o próprio aparelho (localhost), usado em desenvolvimento.
 */
export function normalizeServerUrl(input: string): ServerUrlResult {
	let text = input.trim();
	if (!text) return { ok: false, message: "Digite o endereço do servidor." };
	if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		return {
			ok: false,
			message: "Esse endereço não parece válido. Exemplo: https://financas.seudominio.dev",
		};
	}
	const loopback = LOOPBACK.has(url.hostname);
	if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
		return { ok: false, message: "Use um endereço seguro, começando com https://." };
	}
	if (!url.hostname.includes(".") && !loopback) {
		return {
			ok: false,
			message: "Esse endereço não parece válido. Exemplo: https://financas.seudominio.dev",
		};
	}
	return { ok: true, url: url.origin };
}

/** Só dígitos, no máximo 6. Aceita colar "482 915". */
export function sanitizeCode(input: string): string {
	return input.replace(/\D/g, "").slice(0, PAIRING_CODE_LENGTH);
}

export const isCodeComplete = (code: string) => code.length === PAIRING_CODE_LENGTH;
