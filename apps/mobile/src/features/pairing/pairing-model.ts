import { PAIRING_CODE_LENGTH } from "@orbita/shared";

export type ServerUrlResult = { ok: true; url: string } | { ok: false; message: string };

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** IPv4 de rede privada: 10/8 (inclui 10.0.2.2, o host visto pelo emulador Android), 172.16/12 e 192.168/16. */
export function isPrivateIPv4(host: string): boolean {
	const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
	if (!m) return false;
	const [a, b, c, d] = m.slice(1).map(Number) as [number, number, number, number];
	if ([a, b, c, d].some((n) => n > 255)) return false;
	return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * Valida o endereço do servidor e devolve a URL limpa (sem barra no fim, sem caminho).
 * Só https; http é aceito para o próprio aparelho (localhost) e, só em desenvolvimento (`dev`, o
 * `__DEV__` do app), para IPs de rede privada. Build de produção nunca aceita http fora de localhost.
 */
export function normalizeServerUrl(input: string, options: { dev?: boolean } = {}): ServerUrlResult {
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
	const cleartextOk = loopback || (options.dev === true && isPrivateIPv4(url.hostname));
	if (url.protocol !== "https:" && !(url.protocol === "http:" && cleartextOk)) {
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
