/*
 * Porta do modelo. O loop e as ferramentas só conhecem estes tipos; quem fala com a Anthropic de verdade é
 * `anthropic-client.ts`. Os testes usam um cliente falso (nenhum teste chama a API real).
 */

/** Um bloco de conteúdo. Blocos que o loop não entende (ex.: `thinking`) passam adiante sem mudar. */
export interface ModelBlock {
	type: string;
	[key: string]: unknown;
}

export interface ModelMessage {
	role: "user" | "assistant";
	content: string | ModelBlock[];
}

export interface SystemBlock {
	text: string;
	/** Marca o fim do trecho estável do prompt: tudo antes dele (ferramentas incluídas) entra no cache. */
	cache?: boolean;
}

export interface ToolSchema {
	name: string;
	description: string;
	input_schema: Record<string, unknown>;
}

export type Effort = "low" | "medium" | "high";

export interface ModelRequest {
	model: string;
	maxTokens: number;
	system: SystemBlock[];
	tools: ToolSchema[];
	messages: ModelMessage[];
	/** Quanto o modelo pensa. Ausente = padrão do modelo. */
	effort?: Effort;
}

export interface ModelUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
}

export interface ModelResponse {
	content: ModelBlock[];
	/** `end_turn`, `tool_use`, `max_tokens`, `refusal`… */
	stopReason: string | null;
	usage: ModelUsage;
	/** O modelo que respondeu (pode diferir do pedido se houve troca). */
	model: string;
}

export interface TurnHandlers {
	/** Pedaço de texto assim que chega (streaming). */
	onText(delta: string): void;
}

/** Uma chamada ao modelo, com o texto em streaming. Devolve a resposta completa no fim. */
export interface ModelClient {
	turn(request: ModelRequest, handlers: TurnHandlers, signal?: AbortSignal): Promise<ModelResponse>;
}

export const isTextBlock = (b: ModelBlock): b is ModelBlock & { type: "text"; text: string } =>
	b.type === "text" && typeof b.text === "string";

export const isToolUseBlock = (
	b: ModelBlock,
): b is ModelBlock & { type: "tool_use"; id: string; name: string; input: unknown } =>
	b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string";

export const ZERO_USAGE: ModelUsage = {
	inputTokens: 0,
	outputTokens: 0,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
};

export function addUsage(a: ModelUsage, b: ModelUsage): ModelUsage {
	return {
		inputTokens: a.inputTokens + b.inputTokens,
		outputTokens: a.outputTokens + b.outputTokens,
		cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
		cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
	};
}
