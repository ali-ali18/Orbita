import { describe, expect, it } from "vitest";
import { isCodeComplete, isPrivateIPv4, normalizeServerUrl, sanitizeCode } from "./pairing-model.ts";

describe("normalizeServerUrl", () => {
	it("aceita https, tira a barra e o caminho", () => {
		expect(normalizeServerUrl("https://financas.seudominio.dev/")).toEqual({
			ok: true,
			url: "https://financas.seudominio.dev",
		});
		expect(normalizeServerUrl("  https://a.dev:8443/x/y ")).toEqual({ ok: true, url: "https://a.dev:8443" });
	});
	it("sem esquema assume https", () => {
		expect(normalizeServerUrl("financas.seudominio.dev")).toEqual({
			ok: true,
			url: "https://financas.seudominio.dev",
		});
	});
	it("recusa http fora do aparelho e esquemas estranhos", () => {
		expect(normalizeServerUrl("http://financas.seudominio.dev")).toMatchObject({ ok: false });
		expect(normalizeServerUrl("ftp://a.dev")).toMatchObject({ ok: false });
		expect(normalizeServerUrl("javascript:alert(1)")).toMatchObject({ ok: false });
	});
	it("http só para localhost", () => {
		expect(normalizeServerUrl("http://localhost:3700")).toEqual({ ok: true, url: "http://localhost:3700" });
		expect(normalizeServerUrl("http://127.0.0.1:3700")).toEqual({ ok: true, url: "http://127.0.0.1:3700" });
	});
	it("recusa vazio e host sem ponto", () => {
		expect(normalizeServerUrl("   ")).toMatchObject({ ok: false });
		expect(normalizeServerUrl("https://servidor")).toMatchObject({ ok: false });
	});
});

describe("http em desenvolvimento", () => {
	const privateHosts = [
		"http://10.0.2.2:3700",
		"http://10.1.2.3",
		"http://172.16.0.5",
		"http://172.31.255.1",
		"http://192.168.0.10:3700",
	];
	it("aceita IP de rede privada só com dev ligado", () => {
		for (const url of privateHosts) {
			expect(normalizeServerUrl(url, { dev: true })).toMatchObject({ ok: true });
			expect(normalizeServerUrl(url, { dev: false })).toMatchObject({ ok: false });
			expect(normalizeServerUrl(url)).toMatchObject({ ok: false });
		}
	});
	it("não confunde faixas públicas com privadas", () => {
		for (const url of [
			"http://172.15.0.1",
			"http://172.32.0.1",
			"http://192.169.0.1",
			"http://11.0.0.1",
			"http://10.0.0.256",
			"http://8.8.8.8",
		]) {
			expect(normalizeServerUrl(url, { dev: true })).toMatchObject({ ok: false });
		}
		expect(isPrivateIPv4("192.168.1.1")).toBe(true);
		expect(isPrivateIPv4("example.com")).toBe(false);
	});
	it("localhost continua valendo em produção; https vale sempre", () => {
		expect(normalizeServerUrl("http://localhost:3700", { dev: false })).toMatchObject({ ok: true });
		expect(normalizeServerUrl("https://192.168.0.10", { dev: false })).toMatchObject({ ok: true });
	});
});

describe("código", () => {
	it("limpa para 6 dígitos", () => {
		expect(sanitizeCode("482 915")).toBe("482915");
		expect(sanitizeCode("12ab34567890")).toBe("123456");
		expect(isCodeComplete("48291")).toBe(false);
		expect(isCodeComplete("482915")).toBe(true);
	});
});
