import { assertCents } from "./money.ts";
import type { Cents } from "./types.ts";

/**
 * Chave para comparar estabelecimentos: sem acento, minúscula, sem pontuação, sem números soltos (data, parcela,
 * código da loja) e só as primeiras `words` palavras (2 por padrão; 1 compara só a marca). "NETFLIX.COM 12/10" e
 * "Netflix" dão a mesma chave com `words` = 1. Vazio quando não sobra nada comparável.
 */
export function merchantKey(text: string | null | undefined, words = 2): string {
	if (!text) return "";
	const tokens = text
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLocaleLowerCase("pt-BR")
		.replace(/[^a-z0-9]+/g, " ")
		.split(" ")
		.filter((t) => t.length > 0 && !/^\d+$/.test(t));
	return tokens.slice(0, words).join(" ");
}

/** Mediana de centavos, inteira (par: o menor inteiro da média dos dois do meio). Vazio: 0. */
export function medianCents(values: readonly Cents[]): Cents {
	if (values.length === 0) return 0;
	for (const v of values) assertCents(v, "valor");
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	const hi = sorted[mid] as Cents;
	return sorted.length % 2 === 1 ? hi : Math.floor(((sorted[mid - 1] as Cents) + hi) / 2);
}
