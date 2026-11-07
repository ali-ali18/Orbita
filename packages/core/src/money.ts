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

// [sinal] [R$] [sinal], com espaços opcionais entre as peças. A parte inteira com ponto
// exige grupos de 3 e a parte inteira sem zero à esquerda, exceto o "0" sozinho
// ("0.500", "01.234", "0001" e "00,50" são typos).
// Aceita ",50" (sem parte inteira), mas não "12," (vírgula solta).
const BRL_PATTERN =
	/^(?:([-−+])\s*)?(?:R\$\s*)?(?:([-−+])\s*)?(?:([1-9]\d{0,2}(?:\.\d{3})+|0|[1-9]\d*)(?:,(\d{1,2}))?|,(\d{1,2}))$/;

/**
 * Lê dinheiro digitado em pt-BR e devolve centavos. O ponto só vale como separador de
 * milhar (grupos de 3). "46.90" é rejeitado: em pt-BR seria 4.690 reais, em en-US 46,90,
 * e adivinhar errado mexe em dinheiro. "46.900" é válido em pt-BR (46.900,00).
 */
export function parseBRL(text: string): Cents {
	if (typeof text !== "string") throw new TypeError("texto de valor inválido");
	const match = BRL_PATTERN.exec(text.trim());
	if (!match) throw new RangeError(`valor inválido: "${text}"`);
	const [, signA, signB, intPart, decPart, onlyDec] = match;
	if (signA && signB) throw new RangeError(`valor inválido: "${text}"`);
	const sign = signA ?? signB;
	const reais = Number((intPart ?? "").replace(/\./g, "") || "0");
	const cents = reais * 100 + Number((decPart ?? onlyDec ?? "").padEnd(2, "0"));
	if (!Number.isSafeInteger(cents)) throw new RangeError("valor grande demais");
	// `cents === 0` evita devolver -0 ("-0", "-0,00").
	return cents !== 0 && (sign === "-" || sign === "−") ? -cents : cents;
}

/**
 * Converte um valor decimal em reais (número do JSON de uma API ou texto "12.34") em centavos inteiros.
 * Não multiplica por 100: `1.15 * 100` dá 114.99999999999999. Passa por texto com 6 casas
 * (`0.1 + 0.2` vira "0.300000") e arredonda meio centavo para longe do zero. Mantém o sinal.
 */
export function decimalToCents(value: number | string): Cents {
	let text: string;
	if (typeof value === "number") {
		if (!Number.isFinite(value) || Math.abs(value) >= 1e12) throw new RangeError("valor decimal inválido");
		text = value.toFixed(6);
	} else if (typeof value === "string" && /^[-+]?\d{1,12}(\.\d+)?$/.test(value.trim())) {
		text = value.trim();
	} else {
		throw new RangeError("valor decimal inválido");
	}
	const negative = text.startsWith("-");
	const [whole = "0", fraction = ""] = text.replace(/^[-+]/, "").split(".");
	const digits = `${fraction}00`.slice(0, 2);
	let cents = Number(whole) * 100 + Number(digits);
	if (Number(`${fraction}00`.charAt(2)) >= 5) cents += 1;
	// `cents === 0` evita devolver -0.
	return negative && cents !== 0 ? -cents : cents;
}
