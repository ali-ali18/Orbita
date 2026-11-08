import { fetch as expoFetch } from "expo/fetch";
import type { StreamingFetch } from "./chat-client.ts";

/**
 * `fetch` com corpo em streaming. O do React Native não lê a resposta aos poucos; o `expo/fetch` lê (Android, iOS e
 * web). Fica num arquivo próprio para o resto do chat (e os testes) não depender do módulo do Expo.
 */
export const chatFetch = expoFetch as unknown as StreamingFetch;
