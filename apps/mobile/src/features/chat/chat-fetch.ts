import { fetch as expoFetch } from "expo/fetch";
import type { StreamingFetch } from "./chat-client.ts";

/**
 * `fetch` com corpo em streaming. O do React Native não lê a resposta aos poucos; o `expo/fetch` lê (Android, iOS e
 * web). Fica num arquivo próprio para o resto do chat (e os testes) não depender do módulo do Expo.
 *
 * Embrulhado numa função: na web o `expo/fetch` é o `fetch` global, que lança "Illegal invocation" quando é chamado
 * como método de outro objeto (`options.fetchImpl(...)`). Chamar pela função nova deixa o `this` correto.
 */
export const chatFetch = ((...args: Parameters<StreamingFetch>) =>
	expoFetch(...(args as unknown as Parameters<typeof expoFetch>))) as unknown as StreamingFetch;
