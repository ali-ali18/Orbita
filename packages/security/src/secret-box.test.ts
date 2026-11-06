import { describe, expect, it } from "vitest";
import { deriveKey } from "./keys.ts";
import { createSecretBox } from "./secret-box.ts";

const box = createSecretBox(deriveKey("s".repeat(48), "secret-box"));

/** Troca um caractere da parte `index` do formato v1.iv.data.tag. */
function tamper(sealed: string, index: number): string {
	const parts = sealed.split(".");
	const p = parts[index] ?? "";
	parts[index] = (p[0] === "A" ? "B" : "A") + p.slice(1);
	return parts.join(".");
}

describe("secret box", () => {
	it("abre o que cifrou, inclusive vazio e unicode", () => {
		for (const text of ["sk-ant-123", "", "ação 🔐"]) expect(box.open(box.seal(text))).toBe(text);
	});

	it("usa um IV novo a cada vez", () => {
		const a = box.seal("x");
		const b = box.seal("x");
		expect(a).not.toBe(b);
		expect(a.startsWith("v1.")).toBe(true);
	});

	it("não deixa o texto em claro no resultado", () => {
		expect(box.seal("sk-ant-segredo")).not.toContain("segredo");
	});

	it("detecta adulteração em cada parte", () => {
		const sealed = box.seal("sk-ant-123");
		for (const index of [1, 2, 3]) expect(() => box.open(tamper(sealed, index))).toThrow();
	});

	it("recusa chave errada", () => {
		const other = createSecretBox(deriveKey("t".repeat(48), "secret-box"));
		expect(() => other.open(box.seal("x"))).toThrow(/chave errada ou dado adulterado/);
	});

	it("amarra ao aad", () => {
		const sealed = box.seal("x", "setting:anthropic_key");
		expect(box.open(sealed, "setting:anthropic_key")).toBe("x");
		expect(() => box.open(sealed, "setting:pluggy_key")).toThrow();
		expect(() => box.open(sealed)).toThrow();
	});

	it("recusa formato ruim e versão desconhecida", () => {
		expect(() => box.open("lixo")).toThrow(/formato inválido/);
		expect(() => box.open("v1.a.b")).toThrow(/formato inválido/);
		expect(() => box.open("v1.a.b.c")).toThrow(/formato inválido/);
		expect(() => box.open(box.seal("x").replace("v1.", "v2."))).toThrow(/Versão/);
	});

	it("exige chave de 32 bytes", () => {
		expect(() => createSecretBox(Buffer.alloc(16))).toThrow();
	});
});
