import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	BARE_CODE_PATTERN,
	NOTIFICATION_BANK_PACKAGES,
	NOTIFICATION_BATCH_MAX,
	NOTIFICATION_TEXT_MAX,
	NOTIFICATION_TITLE_MAX,
	SENSITIVE_PATTERN,
} from "@orbita/shared";
import { describe, expect, it } from "vitest";

/*
 * O serviço nativo (Kotlin) não importa `@orbita/shared`: a lista de pacotes, os limites e as palavras de código de
 * verificação são copiados. Este teste lê o código-fonte do módulo e confere que a cópia não se afastou do original,
 * porque uma lista de pacotes desatualizada seria a diferença entre ler só bancos e ler outro app.
 */
const NATIVE = join(
	__dirname,
	"../../../modules/orbita-notifications/android/src/main/java/expo/modules/orbitanotifications",
);
const policy = readFileSync(join(NATIVE, "NotificationPolicy.kt"), "utf8");

describe("módulo nativo de notificações espelha o que o servidor aceita", () => {
	it("a lista de pacotes de banco é a mesma", () => {
		const block = /BANK_PACKAGES: Set<String> = setOf\(([\s\S]*?)\n {2}\)/.exec(policy)?.[1] ?? "";
		const native = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string).sort();
		const shared = Object.values(NOTIFICATION_BANK_PACKAGES).flat().sort();
		expect(native).toEqual(shared);
	});

	it("os limites de tamanho são os mesmos", () => {
		const read = (name: string) => Number(new RegExp(`const val ${name} = (\\d+)`).exec(policy)?.[1]);
		expect(read("TITLE_MAX")).toBe(NOTIFICATION_TITLE_MAX);
		expect(read("TEXT_MAX")).toBe(NOTIFICATION_TEXT_MAX);
		expect(read("BATCH_MAX")).toBe(NOTIFICATION_BATCH_MAX);
	});

	it("as regras de código de verificação são idênticas", () => {
		const literal = (name: string) =>
			new RegExp(`private val ${name} = Regex\\(\\s*"([^"]+)"`).exec(policy)?.[1]?.replaceAll("\\\\", "\\") ??
			"";
		expect(literal("SENSITIVE")).toBe(SENSITIVE_PATTERN);
		expect(literal("BARE_CODE")).toBe(BARE_CODE_PATTERN);
	});
});
