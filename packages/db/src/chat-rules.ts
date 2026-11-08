import { CHAT_TEXT_MAX, CHAT_TITLE_MAX, type ChatRole } from "./chat-store.ts";
import { invalid } from "./errors.ts";

/** Normalizadores do chat, iguais nos stores Prisma e memória. */

/** Título: espaços colapsados e cortado em `CHAT_TITLE_MAX`; vazio vira "Conversa". */
export function cleanChatTitle(raw: string): string {
	const text = String(raw).replace(/\s+/g, " ").trim();
	if (text.length === 0) return "Conversa";
	return text.length > CHAT_TITLE_MAX ? `${text.slice(0, CHAT_TITLE_MAX - 1).trimEnd()}…` : text;
}

export function cleanChatMessage(message: { role: ChatRole; text: string }): {
	role: ChatRole;
	text: string;
} {
	if (message.role !== "user" && message.role !== "assistant") throw invalid("Papel da mensagem inválido.");
	if (typeof message.text !== "string") throw invalid("Texto da mensagem inválido.");
	if (message.text.length > CHAT_TEXT_MAX) throw invalid("A mensagem é grande demais.");
	// A resposta da IA pode terminar só em cards (texto vazio); a do dono nunca.
	if (message.role === "user" && message.text.trim().length === 0) throw invalid("Escreva a mensagem.");
	return { role: message.role, text: message.text };
}

export const MAX_AI_LIMIT_USD_CENTS = 1_000_000;

export function cleanAiLimit(value: number | null): number | null {
	if (value === null) return null;
	if (!Number.isInteger(value) || value < 0 || value > MAX_AI_LIMIT_USD_CENTS) {
		throw invalid("O limite deve ser um inteiro de centavos de dólar, de 0 a 1.000.000.");
	}
	return value;
}

export function cleanModelId(value: string | null | undefined): string | null | undefined {
	if (value === undefined || value === null) return value;
	if (value.length === 0 || value.length > 80) throw invalid("O id do modelo deve ter de 1 a 80 letras.");
	return value;
}

const COUNT_FIELDS = [
	["inputTokens", "tokens de entrada"],
	["outputTokens", "tokens de saída"],
	["cacheReadTokens", "tokens lidos do cache"],
	["cacheWriteTokens", "tokens gravados no cache"],
	["costMicroUsd", "custo"],
] as const;

/** Todo número do uso é inteiro seguro, zero ou mais (o custo é soma de inteiros: nada de fração). */
export function checkUsageNumbers(input: Record<(typeof COUNT_FIELDS)[number][0], number>): void {
	for (const [key, label] of COUNT_FIELDS) {
		const value = input[key];
		if (!Number.isSafeInteger(value) || value < 0 || value > 2_000_000_000) {
			throw invalid(`O valor de ${label} deve ser um inteiro de zero a dois bilhões.`);
		}
	}
}
