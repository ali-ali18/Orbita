/*
 * Verificação de saída: a IA nunca faz conta, então todo valor em R$ que ela escreve tem de existir, igual, em algum
 * resultado de ferramenta da conversa (ou ter sido dito pelo dono). Função pura: o laço (`runAgent`) usa para pedir ao
 * modelo que refaça a resposta quando ela cita um número que ninguém lhe entregou (uma soma de cabeça, por exemplo).
 *
 * É conservadora de propósito: só olha valores com "R$" na frente, aceita qualquer formato pt-BR ("R$ 1.234,56",
 * "R$ 1234,56", "R$ 95", "−R$ 46,90") e, quando o texto está sem centavos ("R$ 95"), aceita o arredondamento de um valor
 * que existe ("R$ 95,99" → "R$ 95" ou "R$ 96"). Na dúvida, não acusa.
 */

/** Valor em R$ achado no texto: o texto original e os centavos. */
export interface MoneyMention {
	raw: string;
	cents: number;
	/** `true` quando o texto não traz centavos ("R$ 95"). */
	wholeReais: boolean;
}

// "R$ 1.234,56" | "R$ 95". Não casa "R$ 12.34" (ponto decimal: formato que não é pt-BR) nem "R$ 2 mil".
const MONEY = /R\$\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?(?![.,]?\d)(?!\s*(?:mil\b|k\b|mi\b|milh))/g;
// Valor em reais com vírgula nos centavos, em qualquer texto ("46,90", "1.234,56").
const DECIMAL = /(?<![\d.,])(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})(?!\d)/g;
const INTEGER = /\d+/g;

const toCents = (whole: string, fraction: string | undefined): number => {
	const reais = Number(whole.replaceAll(".", ""));
	const cents = fraction === undefined ? 0 : Number(fraction.padEnd(2, "0"));
	return reais * 100 + cents;
};

/** Os valores em R$ de um texto, na ordem em que aparecem. Valor zero e número enorme (fora do inteiro seguro) ficam de fora. */
export function findMoneyMentions(text: string): MoneyMention[] {
	const found: MoneyMention[] = [];
	for (const m of text.matchAll(MONEY)) {
		const cents = toCents(m[1] as string, m[2]);
		if (cents <= 0 || !Number.isSafeInteger(cents)) continue;
		found.push({ raw: m[0], cents, wholeReais: m[2] === undefined });
	}
	return found;
}

/**
 * Centavos que a conversa legitimou: tudo que aparece numa fonte. Em resultado de ferramenta, cada inteiro vale como
 * centavos (os campos `cents`/`amountCents`) e cada "46,90" como valor em reais. Em texto do dono ou da conversa
 * anterior, o inteiro vale também como reais ("paguei 50").
 */
export function collectAllowedCents(
	sources: readonly string[],
	options: { integersAsReais?: boolean } = {},
): Set<number> {
	const allowed = new Set<number>();
	for (const source of sources) {
		for (const m of source.matchAll(DECIMAL)) allowed.add(toCents(m[1] as string, m[2]));
		for (const m of source.matchAll(INTEGER)) {
			const n = Number(m[0]);
			if (!Number.isSafeInteger(n)) continue;
			allowed.add(n);
			if (options.integersAsReais) allowed.add(n * 100);
		}
	}
	return allowed;
}

/** Os valores em R$ do texto que não existem em `allowed` (nem como arredondamento, se vierem sem centavos). */
export function findUngroundedAmounts(text: string, allowed: ReadonlySet<number>): MoneyMention[] {
	let wholeReais: Set<number> | undefined;
	const reaisOf = () => {
		if (!wholeReais) {
			wholeReais = new Set();
			for (const c of allowed) {
				wholeReais.add(Math.floor(c / 100));
				wholeReais.add(Math.round(c / 100));
			}
		}
		return wholeReais;
	};
	return findMoneyMentions(text).filter((m) =>
		m.wholeReais ? !reaisOf().has(m.cents / 100) && !allowed.has(m.cents) : !allowed.has(m.cents),
	);
}

export const UNCONFIRMED_AMOUNT_TEXT = "(valor não confirmado)";

/** O texto sem os valores que ninguém entregou: cada um vira "(valor não confirmado)". Último recurso, depois do pedido de refazer. */
export function redactUngroundedAmounts(text: string, allowed: ReadonlySet<number>): string {
	const bad = new Set(findUngroundedAmounts(text, allowed).map((m) => m.raw));
	if (bad.size === 0) return text;
	return text.replace(MONEY, (raw) => (bad.has(raw) ? UNCONFIRMED_AMOUNT_TEXT : raw));
}

/** O pedido para o modelo refazer a resposta (pt-BR, vai como mensagem do dono-sistema no laço). */
export function regenerationRequest(bad: readonly MoneyMention[]): string {
	const list = [...new Set(bad.map((m) => m.raw.replace(/\s+/g, " ")))].slice(0, 6).join("; ");
	return (
		`Aviso do servidor: sua resposta citou valores em R$ que nenhuma ferramenta devolveu (${list}). ` +
		"Você não pode fazer contas. Escreva a resposta de novo usando apenas valores que vieram das ferramentas " +
		'(copie o campo "text"). Se o que o dono pediu exige uma soma ou um cálculo que você não tem, chame a ferramenta ' +
		"que devolve o total, ou diga com franqueza que não consegue calcular isso aqui, sem escrever o número."
	);
}
