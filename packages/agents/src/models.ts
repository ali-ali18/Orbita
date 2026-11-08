import type { Effort } from "./model.ts";

/*
 * Quais modelos o chat usa. O padrão mora aqui, num lugar só; o servidor troca por variável de ambiente
 * (`CHAT_MODEL`, `CHAT_MODEL_FAST`, `CHAT_EFFORT`), lida em `apps/api/src/env.ts`.
 */

export const DEFAULT_CHAT_MODEL = "claude-sonnet-5-5";
/** Para perguntas curtas e só de leitura. */
export const DEFAULT_FAST_MODEL = "claude-haiku-5-5";
export const DEFAULT_CHAT_EFFORT: Effort = "low";

/** Valor de `chatModelFast` que desliga a rota barata. */
export const FAST_MODEL_OFF = "off";

export interface ChatModelOption {
	id: string;
	/** "Sonnet 5.5". */
	label: string;
	/** Uma linha em pt-BR para o dono escolher. */
	description: string;
	/** Pode ser o modelo principal / o modelo rápido. */
	main: boolean;
	fast: boolean;
}

/**
 * Os modelos que o dono pode escolher no app. É A lista: para oferecer outro modelo, acrescente aqui e ponha o
 * preço em `pricing.ts`. A API recusa (400) qualquer id fora dela.
 */
export const CHAT_MODEL_OPTIONS: readonly ChatModelOption[] = [
	{
		id: "claude-sonnet-5-5",
		label: "Sonnet 5.5",
		description: "O padrão: equilibrado entre qualidade, velocidade e custo.",
		main: true,
		fast: false,
	},
	{
		id: "claude-opus-5-5",
		label: "Opus 5.5",
		description: "Mais capaz, para perguntas difíceis; custa bem mais.",
		main: true,
		fast: false,
	},
	{
		id: "claude-haiku-5-5",
		label: "Haiku 5.5",
		description: "O mais rápido e barato; ótimo para perguntas simples.",
		main: true,
		fast: true,
	},
	{
		id: "claude-fable-5-1",
		label: "Fable 5.1",
		description: "O mais capaz da Anthropic, para raciocínio pesado; o mais caro.",
		main: true,
		fast: false,
	},
];

export const isMainModel = (id: string): boolean => CHAT_MODEL_OPTIONS.some((o) => o.id === id && o.main);
/** Vale "off" (desligado) ou um modelo rápido da lista. */
export const isFastModelChoice = (id: string): boolean =>
	id === FAST_MODEL_OFF || CHAT_MODEL_OPTIONS.some((o) => o.id === id && o.fast);

/** O que o dono salvou no app; `null` = não escolheu (vale o padrão do servidor). */
export interface SavedChatModels {
	chatModel: string | null;
	chatModelFast: string | null;
}

/**
 * Precedência: o que o dono salvou no app vence; sem nada salvo, valem as variáveis de ambiente (`defaults`).
 * Um valor salvo que saiu da lista é ignorado (volta ao padrão em vez de quebrar o chat).
 */
export function resolveChatModels(defaults: ChatModelConfig, saved: SavedChatModels): ChatModelConfig {
	const main = saved.chatModel !== null && isMainModel(saved.chatModel) ? saved.chatModel : defaults.main;
	let fast = defaults.fast;
	if (saved.chatModelFast !== null && isFastModelChoice(saved.chatModelFast)) {
		fast = saved.chatModelFast === FAST_MODEL_OFF ? null : saved.chatModelFast;
	}
	return { ...defaults, main, fast };
}

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
