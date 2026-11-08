import type { Effort } from "./model.ts";

/*
 * Quais modelos o chat usa. O padrão mora aqui, num lugar só; o servidor troca por variável de ambiente
 * (`CHAT_MODEL`, `CHAT_MODEL_FAST`, `CHAT_EFFORT`), lida em `apps/api/src/env.ts`.
 */

export const DEFAULT_CHAT_MODEL = "claude-sonnet-5-5";
/** Para perguntas curtas e só de leitura. */
export const DEFAULT_FAST_MODEL = "claude-haiku-5-5";
export const DEFAULT_CHAT_EFFORT: Effort = "low";

export interface ChatModelConfig {
	/** Modelo das conversas em geral e de qualquer coisa que escreve. */
	main: string;
	/** Modelo barato; `null` desliga a rota barata (tudo vai no principal). */
	fast: string | null;
	effort: Effort;
}

export const DEFAULT_CHAT_MODEL_CONFIG: ChatModelConfig = {
	main: DEFAULT_CHAT_MODEL,
	fast: DEFAULT_FAST_MODEL,
	effort: DEFAULT_CHAT_EFFORT,
};

const FAST_MAX_LENGTH = 70;
// Quem pede para escrever (lançar, categorizar, confirmar) ou traz um valor vai no modelo principal.
const WRITE_WORDS =
	/\b(lan[cç]a\w*|lan[cç]ei|gastei|paguei|recebi|registr\w+|categori\w+|confirm\w+|troc\w+|mud\w+|corrig\w+|apag\w+|desfa\w+)\b/i;
const HAS_MONEY = /\d/;

/**
 * Escolhe o modelo do turno. Regra simples e previsível: só a PRIMEIRA mensagem de uma conversa, curta, sem número
 * e sem verbo de escrita usa o modelo barato. Uma conversa em andamento fica no principal (o contexto já é dele).
 */
export function pickModel(
	config: ChatModelConfig,
	input: { text: string; isFirstMessage: boolean },
): { model: string; effort: Effort | undefined } {
	const text = input.text.trim();
	const simple =
		config.fast !== null &&
		input.isFirstMessage &&
		text.length <= FAST_MAX_LENGTH &&
		!HAS_MONEY.test(text) &&
		!WRITE_WORDS.test(text);
	if (simple && config.fast) return { model: config.fast, effort: undefined };
	return { model: config.main, effort: config.effort };
}
