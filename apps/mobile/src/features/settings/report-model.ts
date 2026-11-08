/*
 * "Reportar um problema": monta uma issue pré-preenchida no GitHub. O texto sai do aparelho só quando o dono
 * toca em "Abrir no GitHub" e confirma lá; nada é enviado por este app. Dados técnicos = versão, plataforma,
 * sistema e modelo do aparelho. Nunca valores, nomes, o nome que o dono deu ao aparelho nem o endereço do servidor.
 */

export const REPO = "ali-ali18/Orbita";
export const REPO_URL = `https://github.com/${REPO}`;
/** Instruções de backup do servidor (Dokploy), no repositório. */
export const BACKUP_DOCS_URL = `${REPO_URL}/blob/main/docs/servidor.md#backup`;

/** Limite da descrição (o endereço inteiro tem de caber no que o GitHub e o navegador aceitam). */
export const DESCRIPTION_MAX = 800;
const TITLE_MAX = 70;

export interface TechInfo {
	appVersion: string | null;
	platform: string;
	osVersion: string | null;
	deviceModel: string | null;
}

export type ReportInput = { description: string; tech: TechInfo | null };

export type ReportResult = { ok: true; url: string } | { ok: false; message: string };

/** Título curto: a primeira linha da descrição, cortada. */
export function issueTitle(description: string): string {
	const line = description.trim().split(/\r?\n/)[0]?.trim() ?? "";
	const cut = line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1).trimEnd()}…` : line;
	return cut || "Problema no app";
}

/** O bloco técnico, em lista; só campos que existem. */
export function techBlock(tech: TechInfo): string {
	const rows: Array<[string, string | null]> = [
		["Versão do app", tech.appVersion],
		["Plataforma", tech.platform],
		["Sistema", tech.osVersion],
		["Aparelho", tech.deviceModel],
	];
	return rows
		.filter((row): row is [string, string] => row[1] !== null && row[1] !== "")
		.map(([label, value]) => `- ${label}: ${value}`)
		.join("\n");
}

export function issueBody({ description, tech }: ReportInput): string {
	const parts = [description.trim()];
	if (tech) parts.push(`### Dados técnicos\n${techBlock(tech)}`);
	return parts.join("\n\n");
}

export function validateDescription(description: string): string | null {
	const text = description.trim();
	if (text.length < 5) return "Conte o que aconteceu (pelo menos algumas palavras).";
	if (text.length > DESCRIPTION_MAX) return `A descrição passa de ${DESCRIPTION_MAX} letras.`;
	return null;
}

export function buildIssueUrl(input: ReportInput): ReportResult {
	const problem = validateDescription(input.description);
	if (problem) return { ok: false, message: problem };
	const query = `title=${encodeURIComponent(issueTitle(input.description))}&body=${encodeURIComponent(issueBody(input))}`;
	return { ok: true, url: `${REPO_URL}/issues/new?${query}` };
}
