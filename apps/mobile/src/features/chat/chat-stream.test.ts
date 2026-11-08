import type { ChatEvent } from "@orbita/shared";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../lib/api.ts";
import { type StreamingFetch, streamChat } from "./chat-client.ts";
import { createSseParser } from "./sse.ts";

const sse = (event: ChatEvent) => `data: ${JSON.stringify(event)}\n\n`;

describe("leitor de SSE", () => {
	it("junta pedaços que cortam o evento ao meio e entende \\r\\n", () => {
		const parser = createSseParser();
		const full = `${sse({ type: "meta", conversationId: "c1" })}${sse({ type: "text", delta: "Olá, ç" })}`;
		const events = [
			...parser.feed(full.slice(0, 20)),
			...parser.feed(full.slice(20, 60)),
			...parser.feed(full.slice(60)),
		];
		expect(events).toEqual([
			{ type: "meta", conversationId: "c1" },
			{ type: "text", delta: "Olá, ç" },
		]);
		expect(createSseParser().feed('data: {"type":"done","messageId":"m"}\r\n\r\n')).toEqual([
			{ type: "done", messageId: "m" },
		]);
	});

	it("ignora comentário, JSON quebrado e evento fora do schema, sem derrubar o resto", () => {
		const events = createSseParser().feed(
			`: batimento\n\ndata: {nao-e-json}\n\ndata: {"type":"inventado"}\n\n${sse({ type: "text", delta: "ok" })}`,
		);
		expect(events).toEqual([{ type: "text", delta: "ok" }]);
	});

	it("evento incompleto fica esperando o resto", () => {
		const parser = createSseParser();
		expect(parser.feed('data: {"type":"text","delta":"a"}')).toEqual([]);
		expect(parser.feed("\n\n")).toEqual([{ type: "text", delta: "a" }]);
	});
});

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
			controller.close();
		},
	});
}

const okResponse = (chunks: string[]): Awaited<ReturnType<StreamingFetch>> => ({
	ok: true,
	status: 200,
	headers: { get: () => "text/event-stream" },
	body: streamOf(chunks) as never,
	text: async () => "",
});

const refused = (status: number, body: unknown): Awaited<ReturnType<StreamingFetch>> => ({
	ok: false,
	status,
	headers: { get: () => "application/json" },
	body: null,
	text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

const base = { baseUrl: "https://orbita.example/", token: "orb_t", body: { message: "oi" } };

describe("streamChat", () => {
	it("manda o pedido com o token e entrega os eventos na ordem, mesmo com acento cortado entre pedaços", async () => {
		const calls: Array<{ url: string; init: Parameters<StreamingFetch>[1] }> = [];
		const bytes = new TextEncoder().encode(sse({ type: "text", delta: "ação" }));
		// Corta no meio do "ç" (2 bytes em UTF-8).
		const cut = bytes.indexOf(0xc3) + 1;
		const encoder = new TextEncoder();
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(sse({ type: "meta", conversationId: "c1" })));
				controller.enqueue(bytes.slice(0, cut));
				controller.enqueue(bytes.slice(cut));
				controller.enqueue(encoder.encode(sse({ type: "done", messageId: "m1" })));
				controller.close();
			},
		});
		const events: ChatEvent[] = [];
		await streamChat({
			...base,
			fetchImpl: async (url, init) => {
				calls.push({ url, init });
				return { ...okResponse([]), body: stream as never };
			},
			onEvent: (e) => events.push(e),
		});
		expect(calls[0]?.url).toBe("https://orbita.example/v1/chat");
		expect(calls[0]?.init.headers.authorization).toBe("Bearer orb_t");
		expect(JSON.parse(calls[0]?.init.body ?? "{}")).toEqual({ message: "oi" });
		expect(events.map((e) => e.type)).toEqual(["meta", "text", "done"]);
		expect(events[1]).toEqual({ type: "text", delta: "ação" });
	});

	it("recusa antes do fluxo vira ApiError com o código e a mensagem do servidor", async () => {
		const noKey = {
			error: {
				code: "sem_chave_anthropic",
				message: "Cadastre a chave da Anthropic em Configurações → Servidor e chaves.",
			},
		};
		await expect(
			streamChat({ ...base, fetchImpl: async () => refused(409, noKey), onEvent: () => {} }),
		).rejects.toMatchObject({
			name: "ApiError",
			status: 409,
			code: "sem_chave_anthropic",
			message: "Cadastre a chave da Anthropic em Configurações → Servidor e chaves.",
		});
		await expect(
			streamChat({
				...base,
				fetchImpl: async () => refused(502, "<html>Bad gateway</html>"),
				onEvent: () => {},
			}),
		).rejects.toMatchObject({ status: 502, message: "O servidor recusou o pedido (HTTP 502)." });
		const unauthorized = streamChat({
			...base,
			fetchImpl: async () => refused(401, { error: { code: "nao_autorizado", message: "Pareie de novo." } }),
			onEvent: () => {},
		});
		await expect(unauthorized).rejects.toSatisfy((e) => e instanceof ApiError && e.status === 401);
	});

	it("rede fora do ar vira a mensagem amiga de sempre", async () => {
		await expect(
			streamChat({
				...base,
				fetchImpl: async () => {
					throw new TypeError("Network request failed");
				},
				onEvent: () => {},
			}),
		).rejects.toMatchObject({ code: "sem_conexao", status: null });
	});

	it("fluxo que acaba sem done nem error é conexão cortada; abortar não é erro", async () => {
		await expect(
			streamChat({
				...base,
				fetchImpl: async () => okResponse([sse({ type: "text", delta: "a" })]),
				onEvent: () => {},
			}),
		).rejects.toMatchObject({ code: "fluxo_interrompido" });

		const controller = new AbortController();
		controller.abort();
		await expect(
			streamChat({
				...base,
				signal: controller.signal,
				fetchImpl: async () => okResponse([sse({ type: "text", delta: "a" })]),
				onEvent: () => {},
			}),
		).resolves.toBeUndefined();
	});

	it("erro dentro do fluxo é entregue como evento e conta como fim", async () => {
		const events: ChatEvent[] = [];
		await streamChat({
			...base,
			fetchImpl: async () =>
				okResponse([sse({ type: "error", code: "limite_anthropic", message: "Espere um pouco." })]),
			onEvent: (e) => events.push(e),
		});
		expect(events).toEqual([{ type: "error", code: "limite_anthropic", message: "Espere um pouco." }]);
	});
});
