import { describe, expect, it } from "vitest";
import {
	buildIssueUrl,
	DESCRIPTION_MAX,
	issueBody,
	issueTitle,
	REPO_URL,
	techBlock,
	validateDescription,
} from "./report-model.ts";

const tech = { appVersion: "0.1.0+abc123", platform: "android", osVersion: "15", deviceModel: "Pixel 9" };

describe("reportar problema", () => {
	it("título é a primeira linha, cortada", () => {
		expect(issueTitle("  A fatura não fecha\nem detalhe")).toBe("A fatura não fecha");
		expect(issueTitle("x".repeat(200))).toHaveLength(70);
		expect(issueTitle("x".repeat(200)).endsWith("…")).toBe(true);
		expect(issueTitle("   ")).toBe("Problema no app");
	});

	it("bloco técnico só tem campos que existem", () => {
		expect(techBlock(tech)).toBe(
			"- Versão do app: 0.1.0+abc123\n- Plataforma: android\n- Sistema: 15\n- Aparelho: Pixel 9",
		);
		expect(techBlock({ ...tech, deviceModel: null, osVersion: null })).toBe(
			"- Versão do app: 0.1.0+abc123\n- Plataforma: android",
		);
	});

	it("o corpo leva os dados técnicos só quando o dono deixa ligado", () => {
		expect(issueBody({ description: " Travou ao abrir ", tech: null })).toBe("Travou ao abrir");
		expect(issueBody({ description: "Travou", tech })).toContain("### Dados técnicos\n- Versão do app");
	});

	it("exige descrição e respeita o teto", () => {
		expect(validateDescription("oi")).not.toBeNull();
		expect(validateDescription("a".repeat(DESCRIPTION_MAX + 1))).not.toBeNull();
		expect(validateDescription("A tela de orçamento travou")).toBeNull();
		expect(buildIssueUrl({ description: "oi", tech: null }).ok).toBe(false);
	});

	it("monta o endereço da issue do repositório, com tudo codificado", () => {
		const result = buildIssueUrl({ description: "Erro & problema #1\nlinha 2", tech });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const url = new URL(result.url);
		expect(`${url.origin}${url.pathname}`).toBe(`${REPO_URL}/issues/new`);
		expect(url.searchParams.get("title")).toBe("Erro & problema #1");
		const body = url.searchParams.get("body") ?? "";
		expect(body).toContain("Erro & problema #1\nlinha 2");
		expect(body).toContain("- Aparelho: Pixel 9");
		expect([...url.searchParams.keys()]).toEqual(["title", "body"]);
	});

	it("no pior caso (tudo com acento) o endereço fica abaixo de 8 mil caracteres", () => {
		const result = buildIssueUrl({ description: "ã".repeat(DESCRIPTION_MAX), tech });
		expect(result.ok && result.url.length < 8000).toBe(true);
	});
});
