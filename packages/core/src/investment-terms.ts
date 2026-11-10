/*
 * Condições de um investimento que o dono informa (taxa contratada, valor aplicado, data da aplicação). Fonte da
 * verdade dos limites; `@orbita/shared` (`investment-terms.ts`) repete as listas e os limites para o schema da API, e um
 * teste em `@orbita/db` garante que são iguais.
 *
 * Unidade da taxa: INTEIRO em CENTÉSIMOS DE PONTO PERCENTUAL: 102% do CDI = 10200, 13,5% a.a. = 1350, IPCA + 6,2% = 620.
 */

/** CDI_PERCENT: "102% do CDI". PREFIXED: "13% a.a.". IPCA_PLUS: "IPCA + 6%" (a parte fixa). */
export const INVESTMENT_RATE_KINDS = ["CDI_PERCENT", "PREFIXED", "IPCA_PLUS"] as const;
export type InvestmentRateKind = (typeof INVESTMENT_RATE_KINDS)[number];

/** De onde veio cada campo: BANK = sincronização; USER = o dono informou; NAME_HINT = sugestão tirada do nome. */
export const TERM_SOURCES = ["BANK", "USER", "NAME_HINT"] as const;
export type TermSource = (typeof TERM_SOURCES)[number];

export const RATE_LIMITS_BPS: Record<InvestmentRateKind, { min: number; max: number; label: string }> = {
	CDI_PERCENT: { min: 1, max: 100_000, label: "A taxa em % do CDI deve ficar entre 0,01% e 1000%." },
	PREFIXED: { min: 1, max: 10_000, label: "A taxa prefixada deve ficar entre 0,01% e 100% ao ano." },
	IPCA_PLUS: { min: 0, max: 10_000, label: "A taxa do IPCA + deve ficar entre 0% e 100% ao ano." },
};

/** Data de aplicação mais antiga aceita. */
export const MIN_APPLICATION_DATE = "1995-01-01";

/** Confere tipo + taxa; devolve a mensagem em pt-BR do primeiro problema, ou `null`. */
export function rateProblem(kind: InvestmentRateKind | null, bps: number | null): string | null {
	if (kind === null && bps === null) return null;
	if (kind === null || bps === null) return "Informe o tipo da taxa e o valor dela juntos.";
	if (!Number.isInteger(bps)) return "A taxa deve ser um inteiro em centésimos de ponto percentual.";
	const limit = RATE_LIMITS_BPS[kind];
	return bps < limit.min || bps > limit.max ? limit.label : null;
}
