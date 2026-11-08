import type { ChatEvent, ChatRequestBody } from "@orbita/shared";
import { ApiError, UNREACHABLE_MESSAGE } from "../../lib/api.ts";
import { createSseParser } from "./sse.ts";

/** O `fetch` com leitura em streaming (`expo/fetch` no app; os testes passam um falso). */
export type StreamingFetch = (
	url: string,
	init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{
	ok: boolean;
	status: number;
	headers: { get(name: string): string | null };
	body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } } | null;
	text(): Promise<string>;
}>;

export const STREAM_BROKEN_MESSAGE = "A conexão caiu no meio da resposta. Tente de novo.";

/**
 * Manda a mensagem e entrega os eventos do SSE aos poucos. Recusas que vêm antes do fluxo (sem chave, limite do
 * mês, limite de pedidos, token inválido) chegam como JSON e viram `ApiError` com o código do servidor.
 * Quem chama decide o que fazer com cada código (`sem_chave_anthropic` leva a Servidor e chaves).
 */
export async function streamChat(options: {
	baseUrl: string;
	token: string;
	body: ChatRequestBody;
	fetchImpl: StreamingFetch;
	onEvent: (event: ChatEvent) => void;
	signal?: AbortSignal;
}): Promise<void> {
	const url = `${options.baseUrl.replace(/\/+$/, "")}/v1/chat`;
	let response: Awaited<ReturnType<StreamingFetch>>;
	try {
		response = await options.fetchImpl(url, {
			method: "POST",
			headers: {
				authorization: `Bearer ${options.token}`,
				"content-type": "application/json",
				accept: "text/event-stream",
			},
			body: JSON.stringify(options.body),
			...(options.signal ? { signal: options.signal } : {}),
		});
	} catch {
		throw new ApiError(UNREACHABLE_MESSAGE, null, "sem_conexao");
	}

	if (!response.ok) throw await refusal(response);
	if (!response.body) throw new ApiError(STREAM_BROKEN_MESSAGE, response.status, "fluxo_invalido");

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const parser = createSseParser();
	let finished = false;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			for (const event of parser.feed(decoder.decode(value, { stream: true }))) {
				if (event.type === "done" || event.type === "error") finished = true;
				options.onEvent(event);
			}
		}
	} catch {
		if (options.signal?.aborted) return;
		throw new ApiError(STREAM_BROKEN_MESSAGE, null, "fluxo_interrompido");
	}
	// O servidor sempre fecha com `done` ou `error`; fim de fluxo sem eles é conexão cortada.
	if (!finished && !options.signal?.aborted)
		throw new ApiError(STREAM_BROKEN_MESSAGE, null, "fluxo_interrompido");
}

async function refusal(response: Awaited<ReturnType<StreamingFetch>>): Promise<ApiError> {
	try {
		const body = JSON.parse(await response.text()) as { error?: { code?: unknown; message?: unknown } };
		const message = body.error?.message;
		if (typeof message === "string") {
			const code = typeof body.error?.code === "string" ? body.error.code : "erro";
			return new ApiError(message, response.status, code);
		}
	} catch {
		// Corpo que não é JSON (proxy, página de erro): mensagem genérica abaixo.
	}
	return new ApiError(`O servidor recusou o pedido (HTTP ${response.status}).`, response.status, "erro");
}
