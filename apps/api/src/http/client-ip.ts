import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";

export const UNKNOWN_IP = "desconhecido";

/**
 * Escolhe o IP do cliente. `trustedProxyHops` é quantos proxies NOSSOS há na frente
 * (0 = nenhum: ignora o cabeçalho e usa o socket; 1 = Traefik; 2 = Cloudflare +
 * Traefik). Vale a N-ésima entrada de `X-Forwarded-For` contada da DIREITA: cada
 * proxy nosso acrescenta uma à direita, e as da esquerda vêm do cliente e podem ser
 * forjadas. Cabeçalho com menos entradas que o esperado é suspeito: cai no socket.
 */
export function resolveClientIp(input: {
	trustedProxyHops: number;
	forwardedFor: string | undefined;
	socketAddress: string | undefined;
}): string {
	const hops = input.trustedProxyHops;
	if (hops > 0 && input.forwardedFor) {
		const entries = input.forwardedFor.split(",").map((e) => e.trim());
		const picked = entries.length >= hops ? entries[entries.length - hops] : undefined;
		if (picked) return picked;
	}
	return input.socketAddress || UNKNOWN_IP;
}

export function clientIp(c: Context, trustedProxyHops: number): string {
	let socketAddress: string | undefined;
	try {
		socketAddress = getConnInfo(c).remote.address;
	} catch {
		// Fora do servidor Node (testes com `app.request`) não há socket.
	}
	return resolveClientIp({ trustedProxyHops, forwardedFor: c.req.header("x-forwarded-for"), socketAddress });
}

const HEXTET = /^[0-9a-f]{1,4}$/i;

function parseIpv4(s: string): number[] | null {
	const parts = s.split(".");
	if (parts.length !== 4) return null;
	const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : Number.NaN));
	return nums.every((n) => n >= 0 && n <= 255) ? nums : null;
}

/** Expande um IPv6 em 8 hextets (números). `null` se não for IPv6 válido. */
function parseIpv6(raw: string): number[] | null {
	let s = raw.split("%")[0] ?? ""; // zona (fe80::1%eth0)
	if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
	if (!s.includes(":")) return null;

	// IPv4 no final (::ffff:1.2.3.4) vira dois hextets.
	const lastColon = s.lastIndexOf(":");
	const tail = s.slice(lastColon + 1);
	if (tail.includes(".")) {
		const v4 = parseIpv4(tail);
		if (!v4) return null;
		const [a = 0, b = 0, c = 0, d = 0] = v4;
		s = `${s.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
	}

	const halves = s.split("::");
	if (halves.length > 2) return null;
	const toHextets = (part: string) => (part === "" ? [] : part.split(":"));
	const head = toHextets(halves[0] ?? "");
	const rest = halves.length === 2 ? toHextets(halves[1] ?? "") : [];
	if (![...head, ...rest].every((h) => HEXTET.test(h))) return null;

	let all: string[];
	if (halves.length === 2) {
		const missing = 8 - head.length - rest.length;
		if (missing < 1) return null;
		all = [...head, ...Array<string>(missing).fill("0"), ...rest];
	} else {
		all = head;
	}
	return all.length === 8 ? all.map((h) => Number.parseInt(h, 16)) : null;
}

/**
 * Chave do limite por IP. IPv4 vale como está; IPv6 vale pelo prefixo /64 (quem tem
 * uma rede IPv6 controla 2^64 endereços e contornaria um limite por endereço);
 * `::ffff:1.2.3.4` (IPv4 mapeado) vale como o IPv4. Texto que não é IP volta igual.
 */
export function ipRateLimitKey(ip: string): string {
	const v6 = parseIpv6(ip);
	if (!v6) return ip;
	const [h0 = 0, h1 = 0, h2 = 0, h3 = 0, h4 = 0, h5 = 0, h6 = 0, h7 = 0] = v6;
	if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0xffff) {
		return `${h6 >> 8}.${h6 & 255}.${h7 >> 8}.${h7 & 255}`;
	}
	return `${[h0, h1, h2, h3].map((h) => h.toString(16)).join(":")}::/64`;
}
