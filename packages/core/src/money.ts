import type { Cents } from "./types.ts";

/** Falha cedo: dinheiro fracionado ou fora do inteiro seguro é bug de quem chamou. */
export function assertCents(value: unknown, label = "valor"): asserts value is Cents {
	if (typeof value !== "number") throw new TypeError(`${label} deve ser um número em centavos`);
	if (!Number.isSafeInteger(value)) throw new RangeError(`${label} deve ser um inteiro seguro em centavos`);
}

export function sumCents(values: readonly Cents[]): Cents {
	let total = 0;
	for (const v of values) {
		assertCents(v);
		total += v;
		// Checa a cada passo: depois de perder precisão a soma não volta a ser confiável.
		if (!Number.isSafeInteger(total)) throw new RangeError("soma em centavos excede o inteiro seguro");
	}
	return total;
}

export type SignMode = "auto" | "always" | "never";

/**
 * "R$ 1.234,56". O agrupamento é manual de propósito: `Intl` depende dos dados de
 * locale do runtime (Node sem full-icu, Hermes no celular) e o texto mudaria entre eles.
 * O negativo usa o menos tipográfico (U+2212), que alinha com os algarismos.
 */
export function formatBRL(cents: Cents, options: { sign?: SignMode } = {}): string {
	assertCents(cents);
	const mode = options.sign ?? "auto";
	const abs = Math.abs(cents);
	const reais = Math.floor(abs / 100)
		.toString()
		.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
	const rest = (abs % 100).toString().padStart(2, "0");
	const body = `R$ ${reais},${rest}`;
	if (mode === "never") return body;
	if (cents < 0) return `−${body}`;
	return mode === "always" ? `+${body}` : body;
}

const BRL_PATTERN = /^([-−+])?\s*(?:R\$\s*)?([-−+])?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;

/**
 * Lê dinheiro digitado em pt-BR e devolve centavos. O ponto só vale como separador de
 * milhar (grupos de 3). "46.90" é rejeitado: em pt-BR seria 4.690 reais, em en-US 46,90,
 * e adivinhar errado mexe em dinheiro.
 */
export function parseBRL(text: string): Cents {
	if (typeof text !== "string") throw new TypeError("texto de valor inválido");
	const match = BRL_PATTERN.exec(text.trim());
	if (!match) throw new RangeError(`valor inválido: "${text}"`);
	const [, signA, signB, intPart, decPart] = match;
	if (signA && signB) throw new RangeError(`valor inválido: "${text}"`);
	const sign = signA ?? signB;
	const reais = Number((intPart ?? "").replace(/\./g, ""));
	const cents = reais * 100 + Number((decPart ?? "").padEnd(2, "0"));
	if (!Number.isSafeInteger(cents)) throw new RangeError("valor grande demais");
	return sign === "-" || sign === "−" ? -cents : cents;
}
