import { assertCents } from "./money.ts";
import type { Cents } from "./types.ts";

/** Quantos meses fechados entram na sugestão. */
export const SUGGESTION_MONTHS = 3;

export interface BudgetSuggestion {
	/** Sugestão por id de categoria, em reais inteiros (múltiplos de 100 centavos). Categoria sem gasto não aparece. */
	byCategory: Record<string, Cents>;
	/** Soma das sugestões por categoria. */
	totalCents: Cents;
	/** Quantos dos meses recebidos tinham algum gasto e entraram na conta. */
	monthsUsed: number;
}

function median(sorted: readonly Cents[]): Cents {
	const mid = Math.floor(sorted.length / 2);
	const hi = sorted[mid] as Cents;
	if (sorted.length % 2 === 1) return hi;
	return ((sorted[mid - 1] as Cents) + hi) / 2;
}

/**
 * Orçamento sugerido: a mediana do gasto de cada categoria nos meses recebidos (a mediana não se deixa levar por um
 * mês atípico, como uma viagem), arredondada para reais inteiros. Determinístico, sem IA.
 *
 * `months` traz o gasto por categoria de cada mês FECHADO (o mês corrente, incompleto, não entra). Mês sem nenhum
 * gasto é ignorado (conta recém-aberta não puxa a mediana para zero); dentro de um mês usado, categoria ausente vale 0.
 */
export function suggestBudget(months: readonly Readonly<Record<string, Cents>>[]): BudgetSuggestion {
	const used = months.filter((m) => {
		let total = 0;
		for (const [id, v] of Object.entries(m)) {
			assertCents(v, `gasto de ${id}`);
			total += Math.max(0, v);
		}
		return total > 0;
	});
	const ids = new Set(used.flatMap((m) => Object.keys(m)));
	const byCategory: Record<string, Cents> = {};
	let totalCents = 0;
	for (const id of [...ids].sort()) {
		const values = used.map((m) => Math.max(0, m[id] ?? 0)).sort((a, b) => a - b);
		const reais = Math.round(median(values) / 100);
		if (reais <= 0) continue;
		byCategory[id] = reais * 100;
		totalCents += reais * 100;
	}
	return { byCategory, totalCents, monthsUsed: used.length };
}

/**
 * O gasto passou de `thresholdPercent` % do limite? Conta de inteiros (sem fração): `gasto × 100 > limite × X`.
 * Limite zero: qualquer gasto passa. Em 100 % vira "estourou".
 */
export function passedThreshold(input: {
	limitCents: Cents;
	spentCents: Cents;
	thresholdPercent: number;
}): boolean {
	assertCents(input.limitCents, "limitCents");
	assertCents(input.spentCents, "spentCents");
	const { thresholdPercent: p } = input;
	if (!Number.isInteger(p) || p < 1 || p > 100) throw new RangeError("o aviso vai de 1% a 100%");
	if (input.limitCents < 0) throw new RangeError("o limite não pode ser negativo");
	if (input.spentCents <= 0) return false;
	const spent = input.spentCents * 100;
	const limit = input.limitCents * p;
	if (!Number.isSafeInteger(spent) || !Number.isSafeInteger(limit)) {
		throw new RangeError("conta excede o inteiro seguro");
	}
	return spent > limit;
}
