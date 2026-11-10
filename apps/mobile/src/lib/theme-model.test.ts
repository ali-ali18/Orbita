import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { accentThemeKeys, accentThemes } from "@orbita/tokens";
import { describe, expect, it } from "vitest";
import { accentOf, resolveAccentTheme } from "./theme-model.ts";

describe("resolveAccentTheme", () => {
	it("devolve a chave guardada quando ela existe", () => {
		for (const key of accentThemeKeys) expect(resolveAccentTheme(key)).toBe(key);
	});

	it("sem nada guardado, valor velho ou lixo: o tema atual (branco)", () => {
		for (const bad of [null, undefined, "", "Azul", "roxo", "constructor", "__proto__", " azul"]) {
			expect(resolveAccentTheme(bad)).toBe("atual");
		}
	});
});

describe("accentOf", () => {
	it("devolve accent e onAccent do tema", () => {
		expect(accentOf("azul")).toEqual({ key: "azul", accent: "#2F5BFF", onAccent: "#FFFFFF" });
		expect(accentOf("atual")).toEqual({ key: "atual", accent: "#FFFFFF", onAccent: "#000000" });
	});
});

describe("armazenamento do tema", () => {
	// Lê o texto: importar storage.ts puxaria o módulo nativo do cofre para dentro do teste.
	const storage = readFileSync(join(import.meta.dirname, "storage.ts"), "utf8");

	it("a chave é própria do tema e não colide com outra preferência do aparelho", () => {
		expect(storage).toContain('accentTheme: "orbita.accentTheme"');
		const values = [...storage.matchAll(/^\t\w+: "(orbita\.\w+)",$/gm)].map((m) => m[1]);
		expect(values.length).toBeGreaterThan(3);
		expect(new Set(values).size).toBe(values.length);
	});
});

/*
 * Guarda: o accent é dinâmico. Nada pode ler uma cor primária fixa; telas pedem `useAccent()`/`useTheme()`.
 * Só o modelo do tema e a tela de escolha (que desenha a bolinha de cada opção) leem `accentThemes`.
 */
const SRC = join(import.meta.dirname, "..");
const MAY_READ_THEMES = new Set(["lib/theme-model.ts", "features/settings/theme-options.ts"]);

function sources(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path);
		return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
	});
}

describe("guarda de cor primária estática", () => {
	const files = sources(SRC).map((path) => ({
		rel: path.slice(SRC.length + 1).replaceAll("\\", "/"),
		code: readFileSync(path, "utf8")
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/^\s*\/\/.*$/gm, ""),
	}));

	it("encontra os arquivos do app", () => {
		expect(files.length).toBeGreaterThan(100);
	});

	it("ninguém usa colors.accent nem colors.onAccent", () => {
		const offenders = files.filter((f) =>
			/colors\s*\.\s*(accent|onAccent)\b|colors\[\s*["'](accent|onAccent)/.test(f.code),
		);
		expect(offenders.map((f) => f.rel)).toEqual([]);
	});

	it("só o modelo do tema e a lista de opções leem accentThemes", () => {
		const offenders = files.filter((f) => /\baccentThemes\b/.test(f.code) && !MAY_READ_THEMES.has(f.rel));
		expect(offenders.map((f) => f.rel)).toEqual([]);
	});

	it("hex da cor primária não aparece solto no app", () => {
		const hexes = Object.values(accentThemes).flatMap((t) => [t.accent, t.onAccent]);
		const exclusive = hexes.filter((h) => !["#FFFFFF", "#000000"].includes(h));
		const offenders = files.filter((f) => exclusive.some((h) => f.code.toUpperCase().includes(h)));
		expect(offenders.map((f) => f.rel)).toEqual([]);
	});
});
