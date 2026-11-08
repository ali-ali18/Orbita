import { ALERT_BODY_MAX, ALERT_TITLE_MAX } from "@orbita/shared";
import { type AgentRunResult, type AgentStop, runAgent } from "../loop.ts";
import type { Effort, ModelClient, ModelUsage } from "../model.ts";
import { buildAgentSystem, type PersonaSource, resolvePersona } from "../personas.ts";
import type { PromptContext } from "../prompt.ts";
import type { ToolContext } from "../tool.ts";
import { untrusted } from "../untrusted.ts";
import type { AlertCandidate } from "./collect.ts";

/*
 * Rodada de um agente criado pelo dono: o modelo segue as instruções dele com as ferramentas de leitura liberadas
 * e devolve, no máximo, um aviso. Diferente dos agentes da casa, aqui a IA decide o que dizer (não existe detector
 * para uma instrução livre), então só roda com chave e dentro do limite mensal. Os números continuam vindo das
 * ferramentas, e nenhuma escreve: o que vem de fora é dado e o agente nunca grava nem move dinheiro.
 */

/** O modelo responde isto quando não há nada a avisar. */
export const NO_ALERT = "SEM_AVISO";

export interface CustomRunDeps {
	client: ModelClient;
	toolContext: ToolContext;
	recordUsage(entry: { model: string; usage: ModelUsage }): Promise<void>;
	guard?: () => Promise<string | null>;
	onToolError?: (name: string, error: unknown) => void;
}

export interface CustomRunInput {
	agent: PersonaSource;
	context: PromptContext;
	model: string;
	effort?: Effort | undefined;
	/** Identifica o período da agenda (`2026-11-08`, `w:2026-11-02`, `2026-11`): um aviso por período. */
	period: string;
	signal?: AbortSignal;
}

export interface CustomRunResult {
	alert: AlertCandidate | null;
	stop: AgentStop;
}

export const CUSTOM_MAX_ITERATIONS = 6;
export const CUSTOM_MAX_TOKENS = 800;

const TASK = (period: string) =>
	`Esta é a verificação programada do agente (${period}). Use as ferramentas e as instruções do dono para olhar os dados agora. ` +
	`Se houver algo que o dono precise saber, responda com um aviso de no máximo três frases curtas, copiando os números das ferramentas. ` +
	`Se não houver nada, responda exatamente: ${NO_ALERT}`;

function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export async function runCustomAgent(deps: CustomRunDeps, input: CustomRunInput): Promise<CustomRunResult> {
	const persona = resolvePersona(input.agent);
	const result: AgentRunResult = await runAgent(
		{
			client: deps.client,
			tools: persona.tools,
			toolContext: deps.toolContext,
			// As ferramentas deste agente são só de leitura: não existe escrita para registrar.
			proposals: {
				async create() {
					throw new Error("Agente do dono não grava nada.");
				},
			},
			recordUsage: deps.recordUsage,
			...(deps.guard ? { guard: deps.guard } : {}),
			...(deps.onToolError ? { onToolError: deps.onToolError } : {}),
		},
		{
			model: input.model,
			effort: input.effort,
			system: buildAgentSystem(input.context, persona.roleText),
			history: [],
			userText: TASK(input.period),
			maxIterations: CUSTOM_MAX_ITERATIONS,
			maxTokens: CUSTOM_MAX_TOKENS,
			...(input.signal ? { signal: input.signal } : {}),
		},
	);

	if (result.stop !== "end_turn") return { alert: null, stop: result.stop };
	const text = result.text.trim();
	if (text.length === 0 || text.toUpperCase().includes(NO_ALERT)) return { alert: null, stop: result.stop };
	return {
		alert: {
			kind: "custom",
			dedupeKey: `custom:${input.period}`,
			title: truncate(untrusted(input.agent.name, ALERT_TITLE_MAX) || "Aviso", ALERT_TITLE_MAX),
			body: truncate(text, ALERT_BODY_MAX),
			data: { period: input.period },
			transactionId: null,
			wordedByAi: true,
		},
		stop: result.stop,
	};
}
