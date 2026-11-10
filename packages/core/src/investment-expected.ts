import { addDays, daysBetween } from "./dates.ts";
import type { ProductKind } from "./investment-name-hint.ts";
import type { InvestmentRateKind } from "./investment-terms.ts";
import type { Cents, LocalDate } from "./types.ts";

/*
 * Rendimento ESPERADO de uma renda fixa a partir da taxa contratada, do valor aplicado, da data da aplicação e da série
 * do CDI. Função pura, sem relógio, sem float: ponto fixo com BigInt e arredondamento para centavos só no fim.
 *
 * CONVENÇÕES (documentadas porque mudam o resultado):
 * - Escala do ponto fixo: `FIXED_SCALE` = 10^18 (um fator 1,0005 vira 1_000_500_000_000_000_000n). Cada multiplicação
 *   arredonda para o mais próximo (metade para cima), erro de no máximo 1e-18 por passo.
 * - A taxa do CDI de um dia (`CdiDay.rateE8`) é a fração diária × 10^8 (0,055131% a.d. = 0,00055131 = 55131). É a
 *   escala da série SGS 12 do Banco Central, que publica 6 casas decimais em %.
 * - A taxa do contrato vem em centésimos de ponto percentual: 102% do CDI = 10200; 13,5% a.a. = 1350.
 * - Dia que rende: o CDI publicado em D remunera de D até o dia útil seguinte; então entram os dias da série de
 *   `startDate` (inclusive) até `today` (exclusivo). Dia útil = dia com CDI publicado (sem calendário de feriados).
 * - % do CDI: produto de (1 + taxa_do_dia × percentual). O percentual multiplica a taxa DIÁRIA.
 * - Prefixado: (1 + taxa)^(dias úteis / 252), calculado com a raiz 252 inteira (busca binária em BigInt).
 * - IPCA+: precisa da série do IPCA (fora desta fase): `ipca_unsupported`.
 * - Buraco: a série é lida até o último dia sem lacuna e o resultado diz até que dia vale (`asOf`).
 *   Lacuna = mais de `MAX_CDI_GAP_DAYS` (4) dias corridos entre dois dias publicados COM dia útil (seg a sex) faltando
 *   no meio: trunca. Lacunas menores (feriado de um dia) não truncam e entram em `missingWeekdays` e nos avisos.
 *   LIMITAÇÃO: sem calendário de feriados, o Carnaval (sexta a quarta, 5 dias) também trunca.
 * - IR regressivo sobre o rendimento (22,5% até 180 dias corridos, 20% até 360, 17,5% até 720, 15% acima), resgate
 *   hoje. Isento (LCI, LCA, CRI, CRA, LIG) quando o tipo é conhecido; tipo desconhecido ou que pode ou não ser isento
 *   (debênture) = líquido `null` com motivo. IOF: tabela regressiva do Decreto 6.306/2007 até o 29º dia (96% do
 *   rendimento no 1º dia até 3% no 29º; 0 a partir do 30º), abatido antes do IR.
 * - NÃO modelado (e avisado em `warnings`): resgate parcial, vários aportes, taxa de custódia do Tesouro Direto,
 *   come-cotas (não se aplica a renda fixa direta).
 */

export const FIXED_SCALE = 10n ** 18n;
/** Dias úteis por ano na convenção prefixada brasileira. */
export const BUSINESS_DAYS_PER_YEAR = 252;
/** Maior intervalo (dias corridos) entre dois CDI publicados antes de a série ser tratada como furada. */
export const MAX_CDI_GAP_DAYS = 4;
/** Tolerância (dias corridos) entre a data da aplicação e o primeiro CDI usado (fim de semana e feriado). */
export const START_TOLERANCE_DAYS = 4;
/** Taxa diária plausível do CDI: de 0,001% a 0,2% (fração × 10^8 de 1000 a 200000). */
export const CDI_DAILY_MAX_E8 = 200_000;
/** Piso: taxa diária abaixo de 0,001% (inclusive zero) não é CDI de verdade (fração × 10^8 = 1000). */
export const CDI_DAILY_MIN_E8 = 1_000;
/** Se o último CDI usado é mais velho que isso (dias corridos antes de `today`), avisa que a série está atrasada. */
const STALE_AFTER_DAYS = 4;

export interface CdiDay {
	day: LocalDate;
	/** Fração diária × 10^8. */
	rateE8: number;
}

export type ExpectedUnavailableCode = "ipca_unsupported" | "cdi_unavailable";

export const EXPECTED_UNAVAILABLE_MESSAGES: Record<ExpectedUnavailableCode, string> = {
	ipca_unsupported: "IPCA + taxa ainda não é calculado: falta a série do IPCA.",
	cdi_unavailable: "A série do CDI ainda não cobre o período desta aplicação.",
};

export interface ExpectedYieldInput {
	investedCents: Cents;
	startDate: LocalDate;
	/** Hoje (America/Sao_Paulo). */
	today: LocalDate;
	rate: { kind: InvestmentRateKind; bps: number };
	/** A série do CDI (qualquer ordem; repetidos pelo mesmo dia valem o último). */
	cdi: readonly CdiDay[];
	/** Para o imposto; `null` = desconhecido (o líquido sai `null`). */
	productKind: ProductKind | null;
}

export interface ExpectedYield {
	ok: true;
	/** Valor aplicado + rendimento bruto esperado. */
	grossCents: Cents;
	/** Rendimento bruto esperado (grossCents − aplicado). */
	yieldCents: Cents;
	/** Rendimento depois de IOF e IR; `null` se não dá para saber (veja `netReason`). */
	netYieldCents: Cents | null;
	netReason: string | null;
	iofCents: Cents | null;
	irCents: Cents | null;
	/** O último dia de CDI incluído: o cálculo vale até aqui. */
	asOf: LocalDate;
	/** Dias com CDI publicado dentro do período. */
	businessDays: number;
	/** Dias de semana (seg a sex) sem CDI entre dois dias publicados, em lacunas pequenas (feriado provável). */
	missingWeekdays: number;
	/** Dias corridos da aplicação até hoje (base do IR e do IOF). */
	calendarDays: number;
	warnings: string[];
}

export type ExpectedYieldResult =
	| ExpectedYield
	| { ok: false; code: ExpectedUnavailableCode; message: string };

const unavailable = (code: ExpectedUnavailableCode): ExpectedYieldResult => ({
	ok: false,
	code,
	message: EXPECTED_UNAVAILABLE_MESSAGES[code],
});

// ---------------------------------------------------------------------------------------------------------------------
// Ponto fixo
// ---------------------------------------------------------------------------------------------------------------------

/** a × b ÷ FIXED_SCALE, arredondado para o mais próximo (metade para cima). Só para valores não negativos. */
const mulFixed = (a: bigint, b: bigint): bigint => (a * b + FIXED_SCALE / 2n) / FIXED_SCALE;

/** base^exp em ponto fixo (exp inteiro ≥ 0), por quadrados sucessivos. */
export function powFixed(base: bigint, exp: number): bigint {
	let result = FIXED_SCALE;
	let b = base;
	let e = exp;
	while (e > 0) {
		if (e % 2 === 1) result = mulFixed(result, b);
		b = mulFixed(b, b);
		e = Math.floor(e / 2);
	}
	return result;
}

/** Raiz `n`-ésima de `target` (em ponto fixo, ≥ 1,0): o maior x tal que x^n ≤ target × SCALE^(n-1). Busca binária. */
export function rootFixed(target: bigint, n: number): bigint {
	const goal = target * FIXED_SCALE ** BigInt(n - 1);
	let lo = FIXED_SCALE;
	let hi = target; // para target ≥ 1, a raiz n ≥ 1 não passa do próprio alvo
	while (lo < hi) {
		const mid = (lo + hi + 1n) / 2n;
		if (mid ** BigInt(n) <= goal) lo = mid;
		else hi = mid - 1n;
	}
	return lo;
}

/** Centavos arredondados (metade para cima) de `cents × factor ÷ SCALE`. */
const applyFactor = (cents: Cents, factor: bigint): Cents =>
	Number((BigInt(cents) * factor + FIXED_SCALE / 2n) / FIXED_SCALE);

/** `valor × pct ÷ 10000` arredondado para o mais próximo (metade para cima); pct em centésimos de ponto %. */
const percentOf = (cents: Cents, hundredths: number): Cents =>
	Math.floor((cents * hundredths + 5_000) / 10_000);

// ---------------------------------------------------------------------------------------------------------------------
// Imposto
// ---------------------------------------------------------------------------------------------------------------------

/** IOF regressivo: % do rendimento por dia corrido desde a aplicação (índice = dia 1 a 29; 30 em diante = 0). */
export const IOF_TABLE_PERCENT: readonly number[] = [
	96, 93, 90, 86, 83, 80, 76, 73, 70, 66, 63, 60, 56, 53, 50, 46, 43, 40, 36, 33, 30, 26, 23, 20, 16, 13, 10,
	6, 3,
];

/** % do rendimento cobrado de IOF para um resgate `days` dias corridos depois da aplicação. */
export function iofPercent(days: number): number {
	if (!Number.isInteger(days) || days < 0) throw new RangeError("dias inválidos");
	return days >= 1 && days <= IOF_TABLE_PERCENT.length ? (IOF_TABLE_PERCENT[days - 1] as number) : 0;
}

/** Alíquota do IR regressivo em centésimos de ponto % (22,5% = 2250), por dias corridos. */
export function irRateHundredths(days: number): number {
	if (!Number.isInteger(days) || days < 0) throw new RangeError("dias inválidos");
	if (days <= 180) return 2250;
	if (days <= 360) return 2000;
	if (days <= 720) return 1750;
	return 1500;
}

const IR_EXEMPT: ReadonlySet<ProductKind> = new Set(["LCI", "LCA", "CRI", "CRA", "LIG"]);
const IR_TAXABLE: ReadonlySet<ProductKind> = new Set(["CDB", "RDB", "LC", "LF", "TREASURY"]);

export interface NetYield {
	netYieldCents: Cents | null;
	netReason: string | null;
	iofCents: Cents | null;
	irCents: Cents | null;
}

/** Líquido estimado de um rendimento bruto, resgatando `calendarDays` dias depois da aplicação. */
export function netOfTaxes(
	grossYieldCents: Cents,
	calendarDays: number,
	productKind: ProductKind | null,
): NetYield {
	if (productKind === null) {
		return {
			netYieldCents: null,
			netReason: "Tipo do investimento desconhecido: não dá para saber se há imposto de renda.",
			iofCents: null,
			irCents: null,
		};
	}
	if (!IR_EXEMPT.has(productKind) && !IR_TAXABLE.has(productKind)) {
		return {
			netYieldCents: null,
			netReason: "Debênture pode ou não ter imposto de renda: o líquido não é estimado.",
			iofCents: null,
			irCents: null,
		};
	}
	if (grossYieldCents <= 0)
		return { netYieldCents: grossYieldCents, netReason: null, iofCents: 0, irCents: 0 };
	const iof = percentOf(grossYieldCents, iofPercent(calendarDays) * 100);
	const base = grossYieldCents - iof;
	const ir = IR_EXEMPT.has(productKind) ? 0 : percentOf(base, irRateHundredths(calendarDays));
	return { netYieldCents: base - ir, netReason: null, iofCents: iof, irCents: ir };
}

// ---------------------------------------------------------------------------------------------------------------------
// Rendimento esperado
// ---------------------------------------------------------------------------------------------------------------------

const isWeekday = (d: LocalDate): boolean => {
	const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
	return dow !== 0 && dow !== 6;
};

/** Dias de semana estritamente entre `a` e `b`. */
function weekdaysBetween(a: LocalDate, b: LocalDate): number {
	let n = 0;
	for (let d = addDays(a, 1); d < b; d = addDays(d, 1)) if (isWeekday(d)) n++;
	return n;
}

/**
 * Os dias do CDI que contam, em ordem: de `startDate` (inclusive) a `today` (exclusive), parando antes de uma lacuna
 * (mais de `MAX_CDI_GAP_DAYS` dias corridos com dia útil faltando). Conta os dias úteis que faltaram em lacunas pequenas.
 */
function usableCdi(
	cdi: readonly CdiDay[],
	startDate: LocalDate,
	today: LocalDate,
): { days: CdiDay[]; holeAfter: LocalDate | null; holeBefore: LocalDate | null; missingWeekdays: number } {
	const byDay = new Map<LocalDate, CdiDay>();
	for (const d of cdi) if (d.day >= startDate && d.day < today) byDay.set(d.day, d);
	const sorted = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
	const days: CdiDay[] = [];
	let previous: LocalDate | null = null;
	let missingWeekdays = 0;
	for (const d of sorted) {
		if (previous !== null) {
			const missing = weekdaysBetween(previous, d.day);
			if (missing > 0 && daysBetween(previous, d.day) > MAX_CDI_GAP_DAYS) {
				return { days, holeAfter: previous, holeBefore: d.day, missingWeekdays };
			}
			missingWeekdays += missing;
		}
		days.push(d);
		previous = d.day;
	}
	return { days, holeAfter: null, holeBefore: null, missingWeekdays };
}

const fmtDate = (d: LocalDate): string => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

export function expectedYield(input: ExpectedYieldInput): ExpectedYieldResult {
	const { investedCents, startDate, today, rate, cdi, productKind } = input;
	if (!Number.isSafeInteger(investedCents) || investedCents <= 0)
		throw new RangeError("valor aplicado inválido");
	if (!Number.isInteger(rate.bps) || rate.bps < 0) throw new RangeError("taxa inválida");
	if (startDate > today) throw new RangeError("a data da aplicação não pode ser futura");
	if (rate.kind === "IPCA_PLUS") return unavailable("ipca_unsupported");

	const calendarDays = daysBetween(startDate, today);
	const warnings: string[] = [
		"Cálculo a partir de um único aporte, sem resgates parciais; se houve aportes ou resgates, o valor é aproximado.",
	];
	if (productKind === "TREASURY") warnings.push("Não inclui a taxa de custódia da B3 do Tesouro Direto.");

	// A série precisa existir e alcançar o começo do período (senão o início do rendimento estaria faltando).
	const firstPublished = cdi.reduce<LocalDate | null>(
		(min, d) => (min === null || d.day < min ? d.day : min),
		null,
	);
	if (firstPublished === null || firstPublished > addDays(startDate, START_TOLERANCE_DAYS)) {
		return unavailable("cdi_unavailable");
	}

	const { days, holeAfter, holeBefore, missingWeekdays } = usableCdi(cdi, startDate, today);
	const latestPublished = cdi.reduce<LocalDate>((max, d) => (d.day > max ? d.day : max), firstPublished);
	const first = days[0];
	// Aplicação de hoje (ou de um fim de semana recente): nada rendeu ainda, e isso é verdade, não falta de dado.
	if (first === undefined) {
		// Sem nenhum CDI no período: só é "zero de verdade" se a série está em dia; série atrasada não prova nada.
		if (calendarDays > START_TOLERANCE_DAYS || daysBetween(latestPublished, today) > STALE_AFTER_DAYS) {
			return unavailable("cdi_unavailable");
		}
		return {
			ok: true,
			grossCents: investedCents,
			yieldCents: 0,
			...netOfTaxes(0, calendarDays, productKind),
			asOf: startDate,
			businessDays: 0,
			missingWeekdays: 0,
			calendarDays,
			warnings,
		};
	}
	// O primeiro CDI usado não pode estar muito depois da aplicação (o começo do período ficou sem taxa).
	if (daysBetween(startDate, first.day) > START_TOLERANCE_DAYS) return unavailable("cdi_unavailable");
	if (first.day > startDate) {
		warnings.push(
			`O primeiro CDI usado é ${fmtDate(first.day)}, depois do início (${fmtDate(startDate)}): o rendimento dos dias antes dele não entrou.`,
		);
	}

	let factor = FIXED_SCALE;
	if (rate.kind === "CDI_PERCENT") {
		const pct = BigInt(rate.bps);
		for (const d of days) {
			// taxa_dia × percentual, na escala: (rateE8 / 1e8) × (bps / 1e4) × 1e18 = rateE8 × bps × 1e6.
			factor = mulFixed(factor, FIXED_SCALE + BigInt(d.rateE8) * pct * 1_000_000n);
		}
	} else {
		// (1 + taxa)^(n/252) = ((1 + taxa)^(1/252))^n.
		const annual = FIXED_SCALE + (FIXED_SCALE * BigInt(rate.bps)) / 10_000n;
		factor = powFixed(rootFixed(annual, BUSINESS_DAYS_PER_YEAR), days.length);
	}

	const grossCents = applyFactor(investedCents, factor);
	const yieldCents = grossCents - investedCents;
	const asOf = (days[days.length - 1] as CdiDay).day;

	if (missingWeekdays > 0) {
		warnings.push(
			`${missingWeekdays} dia útil sem CDI na série (feriado ou falha): o rendimento desses dias não entrou.`,
		);
	}
	if (holeAfter !== null && holeBefore !== null) {
		warnings.push(
			`A série do CDI tem uma falha entre ${fmtDate(holeAfter)} e ${fmtDate(holeBefore)}: calculado só até ${fmtDate(asOf)}.`,
		);
	} else if (daysBetween(asOf, today) > STALE_AFTER_DAYS) {
		warnings.push(`O CDI publicado só chega a ${fmtDate(asOf)}: o rendimento vale até essa data.`);
	}

	return {
		ok: true,
		grossCents,
		yieldCents,
		...netOfTaxes(yieldCents, calendarDays, productKind),
		asOf,
		businessDays: days.length,
		missingWeekdays,
		calendarDays,
		warnings,
	};
}
