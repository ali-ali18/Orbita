import {
	type CdiDay,
	expectedYield,
	type InvestmentPositionInput,
	type InvestmentRateKind,
	investmentClassOf,
	isActiveInvestment,
	isBrlInvestment,
	type LocalDate,
	productKindOf,
	rateHintFromName,
	rateProblem,
} from "@orbita/core";
import type { InvestmentRecord, InvestmentTermsRecord } from "@orbita/db";
import type {
	InvestmentMissing,
	InvestmentNameHintDto,
	InvestmentPositionDto,
	InvestmentTermsDto,
} from "@orbita/shared";

/*
 * Junta o que o BANCO informa, o que o DONO informou e o CDI para dizer: o que falta, qual a sugestão pelo nome e quanto
 * deveria ter rendido. Regras: o banco vale sempre; o dono preenche só o que falta; a sugestão pelo nome nunca entra no
 * cálculo. Ausente é `null`, nunca zero.
 */

type TermsFields = Required<
	Pick<
		InvestmentPositionDto,
		| "termsApplicable"
		| "terms"
		| "missing"
		| "nameHint"
		| "expected"
		| "expectedUnavailable"
		| "gapCents"
		| "gapNetCents"
	>
>;

const EMPTY_TERMS: Required<InvestmentTermsDto> = {
	rate: null,
	invested: null,
	startDate: null,
	bank: { rate: null, invested: null, startDate: null },
};

export const notApplicableTerms = (): TermsFields => ({
	termsApplicable: false,
	terms: EMPTY_TERMS,
	missing: [],
	nameHint: null,
	expected: null,
	expectedUnavailable: null,
	gapCents: null,
	gapNetCents: null,
});

/** Decimal em texto ("110", "13.5") para centésimos de ponto percentual; `null` se tem mais de 2 casas ou não é número. */
function decimalToBps(text: string | null): number | null {
	if (text === null) return null;
	const m = /^(\d{1,6})(?:\.(\d{1,8}))?$/.exec(text.trim());
	if (!m) return null;
	const frac = m[2] ?? "";
	if (/[1-9]/.test(frac.slice(2))) return null; // mais de 2 casas significativas: não arredonda em silêncio
	return Number(m[1]) * 100 + Number(frac.slice(0, 2).padEnd(2, "0"));
}

/**
 * Taxa que o banco informou, só quando o formato é inequívoco: `rateType` com CDI e `rate` entre 50 e 300 (110 = 110%
 * do CDI), SEM taxa fixa junto (CDI + spread não é % do CDI); IPCA com `fixedAnnualRate`; prefixado só com `rateType`
 * explícito começando por "PRE" e `fixedAnnualRate`. `rateType` vazio ou outro indexador: ignora (o dono preenche).
 */
export function bankRateOf(r: Pick<InvestmentRecord, "rate" | "rateType" | "fixedAnnualRate">) {
	const type = (r.rateType ?? "").trim().toUpperCase();
	const rate = decimalToBps(r.rate);
	const fixed = decimalToBps(r.fixedAnnualRate);
	let found: { kind: InvestmentRateKind; bps: number } | null = null;
	if (type.includes("CDI")) {
		if (rate !== null && rate >= 5_000 && rate <= 30_000 && !(fixed !== null && fixed > 0)) {
			found = { kind: "CDI_PERCENT", bps: rate };
		}
	} else if (type.includes("IPCA")) {
		if (fixed !== null && fixed > 0) found = { kind: "IPCA_PLUS", bps: fixed };
	} else if (type.startsWith("PRE") && fixed !== null && fixed > 0) {
		found = { kind: "PREFIXED", bps: fixed };
	}
	return found !== null && rateProblem(found.kind, found.bps) === null ? found : null;
}

/**
 * As condições efetivas: o que o DONO informou VENCE (`source: "USER"`); onde ele não disse, vale o do banco
 * (`"BANK"`). O valor do banco vem sempre em `bank`, para a tela mostrar "o banco informa X". Data de início do banco
 * é só `purchaseDate` (`issueDate` é a emissão do papel, não a aplicação).
 */
export function resolveTerms(
	record: InvestmentRecord,
	user: InvestmentTermsRecord | null,
	today: LocalDate,
): Required<InvestmentTermsDto> {
	const bankRate = bankRateOf(record);
	const bankInvested =
		record.investedCents !== null && record.investedCents > 0 ? record.investedCents : null;
	const bankStart = record.purchaseDate !== null && record.purchaseDate <= today ? record.purchaseDate : null;
	const userRate =
		user?.rateKind != null && user.rateBps !== null ? { kind: user.rateKind, bps: user.rateBps } : null;
	return {
		rate: userRate
			? { ...userRate, source: "USER" as const }
			: bankRate
				? { ...bankRate, source: "BANK" as const }
				: null,
		invested:
			user?.investedCents != null
				? { cents: user.investedCents, source: "USER" as const }
				: bankInvested !== null
					? { cents: bankInvested, source: "BANK" as const }
					: null,
		startDate:
			user?.startDate != null
				? { date: user.startDate, source: "USER" as const }
				: bankStart !== null
					? { date: bankStart, source: "BANK" as const }
					: null,
		bank: { rate: bankRate, invested: bankInvested, startDate: bankStart },
	};
}

export function buildTermsFields(args: {
	record: InvestmentRecord;
	input: InvestmentPositionInput;
	user: InvestmentTermsRecord | null;
	cdi: readonly CdiDay[];
	today: LocalDate;
}): TermsFields {
	const { record, input, user, cdi, today } = args;
	const applicable =
		isActiveInvestment(input) &&
		isBrlInvestment(input) &&
		investmentClassOf(record.type, record.subtype) === "fixed_income";
	if (!applicable) return notApplicableTerms();

	const terms = resolveTerms(record, user, today);
	const missing: InvestmentMissing[] = [];
	if (terms.rate === null) missing.push("rate");
	if (terms.invested === null) missing.push("invested");
	if (terms.startDate === null) missing.push("startDate");

	let nameHint: InvestmentNameHintDto | null = null;
	if (terms.rate === null) {
		const h = rateHintFromName(record.name);
		if (h) nameHint = { kind: h.kind, bps: h.bps, matched: h.matched, source: "NAME_HINT" };
	}

	const base = { ...notApplicableTerms(), termsApplicable: true, terms, missing, nameHint };
	if (terms.rate === null || terms.invested === null || terms.startDate === null) return base;

	const result = expectedYield({
		investedCents: terms.invested.cents,
		startDate: terms.startDate.date,
		today,
		rate: { kind: terms.rate.kind, bps: terms.rate.bps },
		cdi,
		productKind: productKindOf(record.subtype, record.name),
	});
	if (!result.ok) return { ...base, expectedUnavailable: { code: result.code, message: result.message } };

	const balance = record.balanceCents;
	return {
		...base,
		expected: {
			grossCents: result.grossCents,
			yieldCents: result.yieldCents,
			netYieldCents: result.netYieldCents,
			iofCents: result.iofCents,
			irCents: result.irCents,
			asOf: result.asOf,
			businessDays: result.businessDays,
			missingWeekdays: result.missingWeekdays,
			reason: result.netReason,
			warnings: result.warnings,
		},
		gapCents: balance === null ? null : balance - result.grossCents,
		gapNetCents:
			balance === null || result.netYieldCents === null
				? null
				: balance - (terms.invested.cents + result.netYieldCents),
	};
}
