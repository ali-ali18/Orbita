import { CHAT_TEXT_MAX, CHAT_TITLE_MAX, CHAT_TITLE_RENAME_MAX, type ChatRole } from "./chat-store.ts";
import { invalid } from "./errors.ts";

/** Normalizadores do chat, iguais nos stores Prisma e memória. */

const MONTHS_SHORT = [
	"jan",
	"fev",
	"mar",
	"abr",
	"mai",
	"jun",
	"jul",
	"ago",
	"set",
	"out",
	"nov",
	"dez",
] as const;

/** "8 nov": o dia e o mês de um instante no fuso de São Paulo. */
function shortDay(at: Date): string {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: "America/Sao_Paulo",
		month: "numeric",
		day: "numeric",
	}).formatToParts(at);
	const month = Number(parts.find((p) => p.type === "month")?.value ?? 1);
	const day = Number(parts.find((p) => p.type === "day")?.value ?? 1);
	return `${day} ${MONTHS_SHORT[month - 1] ?? ""}`;
}

/** Pontuação solta que não deve ficar antes das reticências ("gastei com mercado," vira "gastei com mercado…"). */
const TRAILING_JUNK = /[\s,;:.\-–—/([{"']+$/u;

/**
 * Título da conversa a partir da primeira mensagem: espaços colapsados e, passando de `CHAT_TITLE_MAX` letras,
 * cortado numa fronteira de palavra com "…" no fim (a palavra que não cabe sai inteira; sem espaço útil, corte seco).
 * Conta letras, não unidades UTF-16: emoji nunca é partido. Texto vazio vira "Conversa de 8 nov" (a data de criação).
 */
export function deriveChatTitle(raw: string, createdAt: Date): string {
	const text = String(raw).replace(/\s+/gu, " ").trim();
	if (text.length === 0) return `Conversa de ${shortDay(createdAt)}`;
	const chars = [...text];
	if (chars.length <= CHAT_TITLE_MAX) return text;
	const room = chars.slice(0, CHAT_TITLE_MAX - 1);
	// A palavra termina exatamente no limite quando o próximo caractere é espaço: nada a descartar.
	const endsOnWord = chars[CHAT_TITLE_MAX - 1] === " ";
	const lastSpace = room.lastIndexOf(" ");
	const cut = endsOnWord || lastSpace < CHAT_TITLE_MAX / 2 ? room : room.slice(0, lastSpace);
	const head = cut.join("").replace(TRAILING_JUNK, "");
	return `${head === "" ? cut.join("").trim() : head}…`;
}

/** Nome digitado ao renomear: espaços colapsados; vazio ou acima de `CHAT_TITLE_RENAME_MAX` é recusado. */
export function cleanRenamedTitle(raw: string): string {
	const text = String(raw).replace(/\s+/gu, " ").trim();
	if (text.length === 0) throw invalid("Dê um nome à conversa.");
	if ([...text].length > CHAT_TITLE_RENAME_MAX) {
		throw invalid(`O nome da conversa tem até ${CHAT_TITLE_RENAME_MAX} letras.`);
	}
	return text;
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
