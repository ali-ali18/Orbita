import { INVESTMENT_RATE_KINDS, MIN_APPLICATION_DATE, rateProblem, TERM_SOURCES } from "@orbita/core";
import { isLocalDate, MAX_CENTS } from "@orbita/shared";
import { invalid } from "./errors.ts";
import type { InvestmentTermsInput, InvestmentTermsRecord } from "./investment-terms-store.ts";

/** Normalizador das condições, compartilhado pelo store Prisma e o de memória: mesma regra, mesma mensagem. */
export type NormalizedTerms = Omit<InvestmentTermsRecord, "investmentId" | "createdAt" | "updatedAt">;

export const isEmptyTerms = (t: NormalizedTerms): boolean =>
	t.rateKind === null && t.investedCents === null && t.startDate === null;

export function normalizeTerms(input: InvestmentTermsInput): NormalizedTerms {
	const source = input.source ?? "USER";
	if (!(TERM_SOURCES as readonly string[]).includes(source)) throw invalid("A origem do dado é inválida.");

	const rateKind = input.rateKind ?? null;
	const rateBps = input.rateBps ?? null;
	if (rateKind !== null && !(INVESTMENT_RATE_KINDS as readonly string[]).includes(rateKind)) {
		throw invalid("O tipo de taxa deve ser CDI_PERCENT, PREFIXED ou IPCA_PLUS.");
	}
	if (rateBps !== null && (typeof rateBps !== "number" || !Number.isSafeInteger(rateBps))) {
		throw invalid("A taxa deve ser um inteiro em centésimos de ponto percentual.");
	}
	const problem = rateProblem(rateKind, rateBps);
	if (problem !== null) throw invalid(problem);

	const invested = input.investedCents ?? null;
	if (invested !== null && (!Number.isSafeInteger(invested) || invested <= 0 || invested > MAX_CENTS)) {
		throw invalid("O valor aplicado deve ser um inteiro positivo, em centavos.");
	}

	const startDate = input.startDate ?? null;
	if (startDate !== null && (!isLocalDate(startDate) || startDate < MIN_APPLICATION_DATE)) {
		throw invalid("A data da aplicação é inválida.");
	}

	return {
		rateKind,
		rateBps,
		rateSource: rateKind === null ? null : source,
		investedCents: invested,
		investedSource: invested === null ? null : source,
		startDate,
		startDateSource: startDate === null ? null : source,
	};
}
