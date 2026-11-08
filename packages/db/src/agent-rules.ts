import {
	AGENT_FREQUENCIES,
	AGENT_INSTRUCTIONS_MAX,
	AGENT_NAME_MAX,
	AGENT_TOOLS_MAX,
	type AgentFrequency,
	ALERT_BODY_MAX,
	ALERT_KINDS,
	ALERT_TITLE_MAX,
} from "@orbita/shared";
import { AGENT_DEDUPE_KEY_MAX, type AlertDraft } from "./agent-store.ts";
import { invalid } from "./errors.ts";
import { cleanText } from "./rules.ts";

/** Normalizadores dos agentes, iguais nos stores Prisma e memória (mesma regra, mesma mensagem). */

export function cleanAgentName(value: unknown): string {
	return cleanText(value, "o nome do agente", AGENT_NAME_MAX);
}

export function cleanAgentInstructions(value: unknown): string {
	return cleanText(value, "o que o agente deve fazer", AGENT_INSTRUCTIONS_MAX);
}

export function cleanAgentTools(value: unknown): string[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw invalid("Escolha ao menos uma coisa para o agente ler.");
	}
	if (value.length > AGENT_TOOLS_MAX) throw invalid("Ferramentas demais para um agente.");
	const names = value.map((v) => {
		if (typeof v !== "string" || v.length === 0 || v.length > 64) throw invalid("Ferramenta inválida.");
		return v;
	});
	return [...new Set(names)];
}

export interface Schedule {
	frequency: AgentFrequency;
	runHour: number;
	runDay: number | null;
}

/** Diário não tem dia; semanal vai de 0 (domingo) a 6; mensal de 1 a 28 (todo mês tem esses dias). */
export function cleanSchedule(input: Schedule): Schedule {
	const { frequency, runHour, runDay } = input;
	if (!(AGENT_FREQUENCIES as readonly string[]).includes(frequency)) throw invalid("Frequência inválida.");
	if (!Number.isInteger(runHour) || runHour < 0 || runHour > 23) throw invalid("A hora vai de 0 a 23.");
	if (frequency === "daily") {
		if (runDay !== null) throw invalid("Agenda diária não tem dia.");
	} else if (frequency === "weekly") {
		if (runDay === null || !Number.isInteger(runDay) || runDay < 0 || runDay > 6) {
			throw invalid("O dia da semana vai de 0 (domingo) a 6.");
		}
	} else if (runDay === null || !Number.isInteger(runDay) || runDay < 1 || runDay > 28) {
		throw invalid("O dia do mês vai de 1 a 28.");
	}
	return { frequency, runHour, runDay };
}

export function cleanModel(value: string | null): string | null {
	if (value === null) return null;
	if (typeof value !== "string" || value.length === 0 || value.length > 80) throw invalid("Modelo inválido.");
	return value;
}

const MAX_DATA_JSON = 4000;

export interface CleanAlert {
	kind: AlertDraft["kind"];
	dedupeKey: string;
	title: string;
	body: string;
	data: Record<string, unknown>;
	transactionId: string | null;
	proposalId: string | null;
	wordedByAi: boolean;
}

export function cleanAlertDraft(draft: AlertDraft): CleanAlert {
	if (!(ALERT_KINDS as readonly string[]).includes(draft.kind)) throw invalid("Tipo de aviso inválido.");
	if (
		typeof draft.dedupeKey !== "string" ||
		draft.dedupeKey.length === 0 ||
		draft.dedupeKey.length > AGENT_DEDUPE_KEY_MAX
	) {
		throw invalid("Chave do aviso inválida.");
	}
	const data = draft.data ?? {};
	if (JSON.stringify(data).length > MAX_DATA_JSON) throw invalid("Dados do aviso grandes demais.");
	return {
		kind: draft.kind,
		dedupeKey: draft.dedupeKey,
		title: cleanText(draft.title, "o título do aviso", ALERT_TITLE_MAX),
		body: cleanText(draft.body, "o texto do aviso", ALERT_BODY_MAX),
		data,
		transactionId: draft.transactionId ?? null,
		proposalId: draft.proposalId ?? null,
		wordedByAi: draft.wordedByAi ?? false,
	};
}

export function cleanAlertBody(value: string): string {
	return cleanText(value, "o texto do aviso", ALERT_BODY_MAX);
}

/** Mexer no que só o agente do dono tem (nome, instruções, ferramentas) num agente da casa. */
export const BUILTIN_LOCKED_MESSAGE =
	"Este agente é da casa: só dá para ligar, desligar e ajustar as escolhas dele.";
export const BUILTIN_UNDELETABLE_MESSAGE = "Agente da casa não pode ser apagado. Desligue-o.";
