import type { ModelUsage } from "./model.ts";

/*
 * TABELA DE PREÇOS DA IA, em um lugar só.
 *
 * ATENÇÃO: CONFIRA estes valores em https://platform.claude.com/docs/en/about-claude/pricing antes de confiar
 * no limite mensal. Foram copiados da tabela de preços de 2026-10-06 e a Anthropic muda preço e lança modelo.
 * Modelo que não está aqui é cobrado pelo MAIOR preço da tabela (melhor contar a mais do que a menos).
 *
 * Unidade: micro-dólares por milhão de tokens (US$ 2,00 por MTok = 2_000_000). Assim o custo de uma chamada é
 * `tokens * preço / 1_000_000` micro-dólares, em inteiros, sem ponto flutuante.
 */
export interface ModelPrice {
	input: number;
	output: number;
	/** Leitura do cache (0,1x da entrada). */
	cacheRead: number;
	/** Escrita no cache de 5 minutos (1,25x da entrada). */
	cacheWrite: number;
}

const usd = (dollarsPerMTok: number): number => Math.round(dollarsPerMTok * 1_000_000);

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
	// Entrada/saída por MTok: US$ 2,00 / 10,00 (leitura de cache 0,20).
	"claude-sonnet-5-5": { input: usd(2), output: usd(10), cacheRead: usd(0.2), cacheWrite: usd(2.5) },
	"claude-sonnet-5": { input: usd(2), output: usd(10), cacheRead: usd(0.2), cacheWrite: usd(2.5) },
	// Até 100 mil tokens de prompt (acima disso a Anthropic cobra 0,50 / 2,50: o chat nunca chega lá).
	"claude-haiku-5-5": { input: usd(0.1), output: usd(0.5), cacheRead: usd(0.01), cacheWrite: usd(0.125) },
	"claude-opus-5-5": { input: usd(4), output: usd(20), cacheRead: usd(0.2), cacheWrite: usd(5) },
	"claude-opus-5": { input: usd(5), output: usd(25), cacheRead: usd(0.5), cacheWrite: usd(6.25) },
};

/** O mais caro da tabela: usado para modelo desconhecido. */
export const FALLBACK_PRICE: ModelPrice = Object.values(MODEL_PRICES).reduce((worst, p) => ({
	input: Math.max(worst.input, p.input),
	output: Math.max(worst.output, p.output),
	cacheRead: Math.max(worst.cacheRead, p.cacheRead),
	cacheWrite: Math.max(worst.cacheWrite, p.cacheWrite),
}));

export function priceFor(model: string): { price: ModelPrice; known: boolean } {
	const price = MODEL_PRICES[model];
	return price ? { price, known: true } : { price: FALLBACK_PRICE, known: false };
}

/** Custo da chamada em micro-dólares inteiros, arredondado para cima (uma vez só, no total). */
export function costMicroUsd(model: string, usage: ModelUsage): number {
	const { price } = priceFor(model);
	const scaled =
		usage.inputTokens * price.input +
		usage.outputTokens * price.output +
		usage.cacheReadTokens * price.cacheRead +
		usage.cacheWriteTokens * price.cacheWrite;
	return Math.ceil(scaled / 1_000_000);
}
