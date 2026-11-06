import { describe, expect, it } from "vitest";
import { ipRateLimitKey, resolveClientIp } from "./client-ip.ts";

const ip = (trustedProxyHops: number, forwardedFor: string | undefined, socketAddress = "10.0.0.1") =>
	resolveClientIp({ trustedProxyHops, forwardedFor, socketAddress });

describe("resolveClientIp", () => {
	it("com 0 saltos, ignora o cabeçalho e usa o socket", () => {
		expect(ip(0, "1.1.1.1")).toBe("10.0.0.1");
	});

	it("com 1 salto, usa a entrada mais à direita", () => {
		expect(ip(1, "1.1.1.1, 2.2.2.2, 3.3.3.3")).toBe("3.3.3.3");
		expect(ip(1, " 9.9.9.9 ")).toBe("9.9.9.9");
	});

	it("com 2 saltos, usa a segunda a partir da direita", () => {
		expect(ip(2, "6.6.6.6, 1.1.1.1, 172.16.0.1")).toBe("1.1.1.1");
	});

	it("com menos entradas que saltos, cai no socket", () => {
		expect(ip(2, "1.1.1.1")).toBe("10.0.0.1");
		expect(ip(3, "1.1.1.1, 2.2.2.2")).toBe("10.0.0.1");
	});

	it("sem cabeçalho ou com entrada vazia, cai no socket", () => {
		expect(ip(1, undefined)).toBe("10.0.0.1");
		expect(ip(1, " , ")).toBe("10.0.0.1");
		expect(ip(2, ", 3.3.3.3")).toBe("10.0.0.1");
	});

	it("sem nada, devolve 'desconhecido'", () => {
		expect(resolveClientIp({ trustedProxyHops: 0, forwardedFor: undefined, socketAddress: undefined })).toBe(
			"desconhecido",
		);
	});
});

describe("ipRateLimitKey", () => {
	it("IPv4 fica como está", () => {
		expect(ipRateLimitKey("203.0.113.7")).toBe("203.0.113.7");
	});

	it("IPv6 vira o prefixo /64", () => {
		expect(ipRateLimitKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
		expect(ipRateLimitKey("2001:DB8:1:2::1")).toBe("2001:db8:1:2::/64");
		expect(ipRateLimitKey("2001:0db8:0001:0002:0000:0000:0000:0001")).toBe("2001:db8:1:2::/64");
	});

	it("endereços do mesmo /64 dão a mesma chave; /64 diferentes, não", () => {
		expect(ipRateLimitKey("2001:db8:1:2::1")).toBe(ipRateLimitKey("2001:db8:1:2:f::9"));
		expect(ipRateLimitKey("2001:db8:1:2::1")).not.toBe(ipRateLimitKey("2001:db8:1:3::1"));
	});

	it("trata a compressão '::' em qualquer posição", () => {
		expect(ipRateLimitKey("::1")).toBe("0:0:0:0::/64");
		expect(ipRateLimitKey("2001:db8::")).toBe("2001:db8:0:0::/64");
		expect(ipRateLimitKey("2001::5:6:7:8")).toBe("2001:0:0:0::/64");
		expect(ipRateLimitKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
		expect(ipRateLimitKey("[2001:db8:1:2::1]")).toBe("2001:db8:1:2::/64");
	});

	it("IPv4 mapeado vale como o IPv4", () => {
		expect(ipRateLimitKey("::ffff:1.2.3.4")).toBe("1.2.3.4");
		expect(ipRateLimitKey("::FFFF:102:304")).toBe("1.2.3.4");
		expect(ipRateLimitKey("0:0:0:0:0:ffff:1.2.3.4")).toBe("1.2.3.4");
	});

	it("texto que não é IP volta igual", () => {
		expect(ipRateLimitKey("desconhecido")).toBe("desconhecido");
		expect(ipRateLimitKey("1:2:3")).toBe("1:2:3");
		expect(ipRateLimitKey("1::2::3")).toBe("1::2::3");
	});
});
