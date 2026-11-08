import { assertCents, sumCents } from "./money.ts";
import type { Cents } from "./types.ts";

export const MIN_SPLIT_PARTS = 2;
export const MAX_SPLIT_PARTS = 20;

/**
 * Resultado de conferir uma divisão. `differenceCents` é o que falta (positivo) ou sobra (negativo) para as partes
 * fecharem exatamente no valor original; é o que a tela mostra, nunca uma conta feita no app.
 */
export type SplitCheck =
	| { ok: true; differenceCents: 0 }
	| { ok: false; reason: "parts" | "amount" | "sum"; message: string; differenceCents: Cents };

/**
 * Confere a divisão de um lançamento em partes: de 2 a 20 partes, cada uma com pelo menos 1 centavo, somando
 * EXATAMENTE o valor original. Não arredonda nem completa nada: a diferença volta para quem chamou decidir.
 */
export function checkSplit(totalCents: Cents, partsCents: readonly Cents[]): SplitCheck {
	assertCents(totalCents, "total");
	if (totalCents <= 0) throw new RangeError("o total a dividir deve ser maior que zero");
	for (const part of partsCents) assertCents(part, "parte");
	const differenceCents = totalCents - sumCents(partsCents);
	if (partsCents.length < MIN_SPLIT_PARTS || partsCents.length > MAX_SPLIT_PARTS) {
		return {
			ok: false,
			reason: "parts",
			message: `Divida em ${MIN_SPLIT_PARTS} a ${MAX_SPLIT_PARTS} partes.`,
			differenceCents,
		};
	}
	if (partsCents.some((p) => p <= 0)) {
		return {
			ok: false,
			reason: "amount",
			message: "Cada parte precisa ter valor maior que zero.",
			differenceCents,
		};
	}
	if (differenceCents !== 0) {
		return {
			ok: false,
			reason: "sum",
			message: "As partes precisam somar exatamente o valor do lançamento.",
			differenceCents,
		};
	}
	return { ok: true, differenceCents: 0 };
}

/**
 * Divisão em partes iguais, com o resto dos centavos na primeira (como nas parcelas). Ponto de partida da tela:
 * 10000 em 3 → 3334, 3333, 3333.
 */
export function evenSplit(totalCents: Cents, count: number): Cents[] {
	assertCents(totalCents, "total");
	if (!Number.isInteger(count) || count < MIN_SPLIT_PARTS || count > MAX_SPLIT_PARTS) {
		throw new RangeError(`o número de partes deve ser de ${MIN_SPLIT_PARTS} a ${MAX_SPLIT_PARTS}`);
	}
	if (totalCents < count) throw new RangeError("o total é menor que o número de partes");
	const base = Math.floor(totalCents / count);
	const remainder = totalCents - base * count;
	return Array.from({ length: count }, (_, i) => (i === 0 ? base + remainder : base));
}
