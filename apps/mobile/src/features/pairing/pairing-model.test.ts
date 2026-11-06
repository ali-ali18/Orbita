import { describe, expect, it } from "vitest";
import { isCodeComplete, normalizeServerUrl, sanitizeCode } from "./pairing-model.ts";

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

describe("código", () => {
	it("limpa para 6 dígitos", () => {
		expect(sanitizeCode("482 915")).toBe("482915");
		expect(sanitizeCode("12ab34567890")).toBe("123456");
		expect(isCodeComplete("48291")).toBe(false);
		expect(isCodeComplete("482915")).toBe(true);
	});
});
