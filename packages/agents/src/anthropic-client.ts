import Anthropic from "@anthropic-ai/sdk";
import type { ModelBlock, ModelClient, ModelRequest, ModelResponse } from "./model.ts";

/*
 * O adaptador que fala com a Anthropic de verdade, atrás da porta `ModelClient`. É o ÚNICO arquivo do projeto que
 * importa o SDK. A chave entra por parâmetro (o servidor a lê do cofre a cada pedido) e nunca é logada.
 *
 * Decisões da chamada:
 * - Streaming (`messages.stream`), com o texto entregue aos poucos; a mensagem final traz uso e blocos completos.
 * - Cache de prompt: o fim do trecho estável do system é marcado, e `cache_control` no topo cobre o histórico
 *   que cresce a cada volta do laço de ferramentas.
 * - Pensamento: não se manda `thinking` (os modelos atuais pensam por conta própria; `disabled` seria erro 400).
 *   O esforço (`output_config.effort`) é a alavanca de custo e vem do servidor.
 * - Sem `tool_choice` forçado (os modelos atuais recusam) e sem parâmetros de amostragem.
 */

/** O pedaço do SDK que usamos. Os testes passam um falso com este formato. */
export interface SdkLike {
	messages: {
		stream(params: Record<string, unknown>, options?: { signal?: AbortSignal }): StreamLike;
	};
}

export interface StreamLike {
	on(event: "text", listener: (delta: string) => void): unknown;
	finalMessage(): Promise<{
		content: unknown[];
		stop_reason: string | null;
		model: string;
		usage: {
			input_tokens?: number | null;
			output_tokens?: number | null;
			cache_read_input_tokens?: number | null;
			cache_creation_input_tokens?: number | null;
		};
	}>;
}

export interface AnthropicClientOptions {
	apiKey: string;
	/** Só para testes ou proxy próprio. */
	baseURL?: string;
	timeoutMs?: number;
	/** Só para testes. */
	sdk?: SdkLike;
}

const DEFAULT_TIMEOUT_MS = 90_000;

export function createAnthropicModelClient(options: AnthropicClientOptions): ModelClient {
	const sdk: SdkLike =
		options.sdk ??
		(new Anthropic({
			apiKey: options.apiKey,
			...(options.baseURL ? { baseURL: options.baseURL } : {}),
			timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			maxRetries: 2,
		}) as unknown as SdkLike);

	return {
		async turn(request: ModelRequest, handlers, signal): Promise<ModelResponse> {
			const stream = sdk.messages.stream(buildParams(request), signal ? { signal } : undefined);
			stream.on("text", (delta) => handlers.onText(delta));
			const message = await stream.finalMessage();
			return {
				content: message.content as ModelBlock[],
				stopReason: message.stop_reason,
				model: message.model,
				usage: {
					inputTokens: message.usage.input_tokens ?? 0,
					outputTokens: message.usage.output_tokens ?? 0,
					cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
					cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
				},
			};
		},
	};
}

/** Os parâmetros do `messages.stream`. Exportado para os testes conferirem o que sai pela rede. */
export function buildParams(request: ModelRequest): Record<string, unknown> {
	return {
		model: request.model,
		max_tokens: request.maxTokens,
		system: request.system.map((block) => ({
			type: "text",
			text: block.text,
			...(block.cache ? { cache_control: { type: "ephemeral" } } : {}),
		})),
		tools: request.tools,
		messages: request.messages,
		cache_control: { type: "ephemeral" },
		...(request.effort ? { output_config: { effort: request.effort } } : {}),
	};
}

// ------------------------------------------------------------------ erros

export interface ModelErrorInfo {
	/** `chave_recusada`, `limite_anthropic`, `sobrecarga`, `sem_conexao`, `sem_saldo`, `erro_modelo`. */
	code: string;
	message: string;
}

/**
 * Traduz um erro da chamada em mensagem pt-BR para o dono. Nunca repassa o texto do erro (pode citar a chave ou o
 * corpo da resposta); só o status e o tipo decidem.
 */
export function describeModelError(error: unknown): ModelErrorInfo {
	const e = (typeof error === "object" && error !== null ? error : {}) as {
		status?: unknown;
		name?: unknown;
		message?: unknown;
	};
	const status = typeof e.status === "number" ? e.status : null;
	const name = typeof e.name === "string" ? e.name : "";
	if (name === "AbortError") return { code: "cancelado", message: "A resposta foi interrompida." };
	if (status === 401 || status === 403) {
		return {
			code: "chave_recusada",
			message: "A Anthropic recusou a chave. Confira em Configurações → Servidor e chaves.",
		};
	}
	if (status === 429) {
		return {
			code: "limite_anthropic",
			message: "A Anthropic pediu para esperar um pouco (limite de uso). Tente de novo em instantes.",
		};
	}
	if (status === 400 && typeof e.message === "string" && /credit balance|billing/i.test(e.message)) {
		return {
			code: "sem_saldo",
			message: "A conta da Anthropic está sem saldo. Adicione créditos no console da Anthropic.",
		};
	}
	if (status !== null && (status >= 500 || status === 529)) {
		return {
			code: "sobrecarga",
			message: "A Anthropic está instável agora. Tente de novo em instantes.",
		};
	}
	if (name === "APIConnectionError" || name === "APIConnectionTimeoutError") {
		return { code: "sem_conexao", message: "O servidor não conseguiu falar com a Anthropic. Tente de novo." };
	}
	return { code: "erro_modelo", message: "Não consegui responder agora. Tente de novo." };
}
