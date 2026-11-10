import { z } from "zod";
import { isLocalDate, localDateSchema, MAX_CENTS } from "./finance-primitives.ts";

/*
 * Condições de um investimento que o BANCO quase nunca manda (taxa contratada, valor aplicado, data da aplicação) e que
 * o dono informa. Fica separado de `investments-api.ts` para o engine (`@orbita/core`) e o banco (`@orbita/db`) usarem as
 * mesmas listas e os mesmos limites sem importar o contrato inteiro.
 *
 * Unidade da taxa: INTEIRO em CENTÉSIMOS DE PONTO PERCENTUAL ("bps de porcentagem"): 102% do CDI = 10200, 13,5% a.a. =
 * 1350, IPCA + 6,2% = 620. Nunca decimal.
 */

/** CDI_PERCENT: "102% do CDI". PREFIXED: "13% a.a.". IPCA_PLUS: "IPCA + 6%" (a parte fixa). */
export const INVESTMENT_RATE_KINDS = ["CDI_PERCENT", "PREFIXED", "IPCA_PLUS"] as const;
export type InvestmentRateKind = (typeof INVESTMENT_RATE_KINDS)[number];

/** De onde veio cada campo: BANK = sincronização; USER = o dono informou; NAME_HINT = sugestão tirada do nome. */
export const TERM_SOURCES = ["BANK", "USER", "NAME_HINT"] as const;
export type TermSource = (typeof TERM_SOURCES)[number];

/** Limites aceitos (em centésimos de ponto percentual): CDI 0 a 1000% do CDI; prefixado e IPCA+ 0 a 100% a.a. */
export const RATE_LIMITS_BPS: Record<InvestmentRateKind, { min: number; max: number; label: string }> = {
	CDI_PERCENT: { min: 1, max: 100_000, label: "A taxa em % do CDI deve ficar entre 0,01% e 1000%." },
	PREFIXED: { min: 1, max: 10_000, label: "A taxa prefixada deve ficar entre 0,01% e 100% ao ano." },
	IPCA_PLUS: { min: 0, max: 10_000, label: "A taxa do IPCA + deve ficar entre 0% e 100% ao ano." },
};

/** Data de aplicação mais antiga aceita (sanidade: nenhum CDB do app é anterior a isso). */
export const MIN_APPLICATION_DATE = "1995-01-01";

export const investmentRateKindSchema = z.enum(INVESTMENT_RATE_KINDS, {
	error: "O tipo de taxa deve ser CDI_PERCENT, PREFIXED ou IPCA_PLUS.",
});
export const termSourceSchema = z.enum(TERM_SOURCES);

/** Confere a combinação tipo + taxa; devolve a mensagem em pt-BR do primeiro problema, ou `null`. */
export function rateProblem(kind: InvestmentRateKind | null, bps: number | null): string | null {
	if (kind === null && bps === null) return null;
	if (kind === null || bps === null) return "Informe o tipo da taxa e o valor dela juntos.";
	if (!Number.isInteger(bps)) return "A taxa deve ser um inteiro em centésimos de ponto percentual.";
	const limit = RATE_LIMITS_BPS[kind];
	return bps < limit.min || bps > limit.max ? limit.label : null;
}

/**
 * `PUT /v1/investments/:id/terms`: SUBSTITUI o que o dono informou. Campo ausente ou `null` = não informado (apaga o que
 * havia). Tudo `null` limpa. O que o banco já informa continua valendo: o dono só preenche o que falta.
 * A data da aplicação não pode ser futura: quem sabe "hoje" é a rota (`today`), por isso o schema é uma função.
 */
export function investmentTermsBody(today: string) {
	return z
		.object({
			rateKind: investmentRateKindSchema.nullish(),
			rateBps: z
				.number("A taxa deve ser um número.")
				.int("A taxa deve ser um inteiro em centésimos de ponto percentual.")
				.nullish(),
			investedCents: z
				.number("O valor aplicado deve ser um número.")
				.int("O valor aplicado deve ser inteiro, em centavos.")
				.positive("O valor aplicado deve ser maior que zero.")
				.max(MAX_CENTS, "O valor aplicado passa do limite aceito.")
				.nullish(),
			startDate: localDateSchema
				.refine((d) => d <= today, "A data da aplicação não pode ser futura.")
				.refine((d) => d >= MIN_APPLICATION_DATE, "A data da aplicação é antiga demais.")
				.nullish(),
		})
		.strict()
		.superRefine((v, ctx) => {
			const problem = rateProblem(v.rateKind ?? null, v.rateBps ?? null);
			if (problem !== null) ctx.addIssue({ code: "custom", message: problem, path: ["rateBps"] });
		})
		.transform((v) => ({
			rateKind: v.rateKind ?? null,
			rateBps: v.rateBps ?? null,
			investedCents: v.investedCents ?? null,
			startDate: v.startDate ?? null,
		}));
}
export type InvestmentTermsBody = z.output<ReturnType<typeof investmentTermsBody>>;

export const isApplicationDate = (value: unknown): value is string =>
	isLocalDate(value) && value >= MIN_APPLICATION_DATE;
