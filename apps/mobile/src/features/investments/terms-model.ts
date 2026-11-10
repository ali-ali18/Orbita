import type { InvestmentNameHintDto, InvestmentPositionDto, InvestmentRateKind } from "@orbita/shared";
import { rateProblem } from "@orbita/shared";
import { dayMonth, money } from "../../lib/format.ts";
import { parseReais } from "../activity/filters-model.ts";

/*
 * Condições do investimento (taxa, aplicado, desde) e rendimento esperado. O servidor calcula tudo; aqui só se formata o
 * que ele manda e se monta o corpo do PUT. Campo ausente no DTO = servidor antigo: nada novo aparece.
 */

export type TermsField = "rate" | "invested" | "startDate";

/** O que o `PUT /v1/investments/:id/terms` aceita; só entram as chaves que o dono informou. */
export type TermsPutBody = Partial<{
	rateKind: InvestmentRateKind;
	rateBps: number;
	investedCents: number;
	startDate: string;
}>;

/** A posição tem algo a completar (selo na lista). Servidor antigo (campos ausentes) = nunca. */
export function needsTerms(p: Pick<InvestmentPositionDto, "termsApplicable" | "missing">): boolean {
	return p.termsApplicable === true && (p.missing?.length ?? 0) > 0;
}

/** "2 a completar"; `null` sem nada a completar (ou servidor antigo). */
export function missingChip(count: number | undefined): string | null {
	return count !== undefined && count > 0 ? `${count} a completar` : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Taxa
// ---------------------------------------------------------------------------------------------------------------------

export const RATE_KIND_OPTIONS = [
	{ id: "CDI_PERCENT", label: "% do CDI" },
	{ id: "PREFIXED", label: "Pré" },
	{ id: "IPCA_PLUS", label: "IPCA+" },
] as const satisfies readonly { id: InvestmentRateKind; label: string }[];

/** Centésimos de ponto percentual em texto de campo, vírgula decimal: 10200 → "102", 1350 → "13,5", 1325 → "13,25". */
export function rateToText(bps: number): string {
	const whole = Math.trunc(bps / 100);
	const frac = String(bps % 100)
		.padStart(2, "0")
		.replace(/0+$/, "");
	return frac ? `${whole},${frac}` : String(whole);
}

/** Como a taxa aparece: "102% do CDI", "13,5% a.a.", "IPCA + 6,2%". */
export function rateLabel(kind: InvestmentRateKind, bps: number): string {
	const t = rateToText(bps);
	if (kind === "CDI_PERCENT") return `${t}% do CDI`;
	if (kind === "PREFIXED") return `${t}% a.a.`;
	return `IPCA + ${t}%`;
}

/**
 * Do campo para centésimos de ponto percentual, só com texto ("13,5" → 1350; "102" → 10200; aceita ponto como decimal e
 * "%" no fim). Devolve `{ error }` curto em vez de lançar. Os limites vêm do contrato (`rateProblem`).
 */
export function parseRateText(text: string, kind: InvestmentRateKind): { bps: number } | { error: string } {
	const raw = text.replace(/%/g, "").replace(/\s/g, "");
	if (raw === "") return { error: "Informe a taxa" };
	const m = /^(\d{1,4})(?:[,.](\d{1,2}))?$/.exec(raw);
	if (!m) return { error: "Taxa inválida" };
	const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
	const problem = rateProblem(kind, bps);
	return problem ? { error: problem } : { bps };
}

/** Valor inicial da edição da taxa: o efetivo, senão a sugestão do nome, senão vazio. */
export function rateDraft(p: Pick<InvestmentPositionDto, "terms" | "nameHint">): {
	kind: InvestmentRateKind;
	text: string;
	hint: InvestmentNameHintDto | null;
} {
	const rate = p.terms?.rate;
	if (rate) return { kind: rate.kind, text: rateToText(rate.bps), hint: null };
	const hint = p.nameHint ?? null;
	if (hint) return { kind: hint.kind, text: rateToText(hint.bps), hint };
	return { kind: "CDI_PERCENT", text: "", hint: null };
}

// ---------------------------------------------------------------------------------------------------------------------
// Cartão "Condições"
// ---------------------------------------------------------------------------------------------------------------------

export interface TermsRow {
	field: TermsField;
	label: string;
	/** `null` = falta: a tela mostra "Informar". */
	value: string | null;
	/** O dono informou (marcador "você"). */
	user: boolean;
	a11y: string;
}

const FIELD_LABELS: Record<TermsField, string> = { rate: "Taxa", invested: "Aplicado", startDate: "Desde" };

/** "3 de nov", ou "3 de nov de 2025" quando não é do ano de hoje. */
export function startLabel(date: string, today: string): string {
	return date.slice(0, 4) === today.slice(0, 4) ? dayMonth(date) : `${dayMonth(date)} de ${date.slice(0, 4)}`;
}

function row(field: TermsField, value: string | null, user: boolean): TermsRow {
	const label = FIELD_LABELS[field];
	return {
		field,
		label,
		value,
		user,
		a11y: `${label}, ${value ?? "informar"}${user ? ", informado por você" : ""}`,
	};
}

/** As três linhas; `null` quando não se aplica (não é renda fixa em reais) ou o servidor é antigo. */
export function termsRows(
	p: Pick<InvestmentPositionDto, "termsApplicable" | "terms">,
	hidden: boolean,
	today: string,
): TermsRow[] | null {
	const t = p.terms;
	if (p.termsApplicable !== true || !t) return null;
	return [
		row("rate", t.rate ? rateLabel(t.rate.kind, t.rate.bps) : null, t.rate?.source === "USER"),
		row(
			"invested",
			t.invested ? money(t.invested.cents, hidden, { sign: "never" }) : null,
			t.invested?.source === "USER",
		),
		row(
			"startDate",
			t.startDate ? startLabel(t.startDate.date, today) : null,
			t.startDate?.source === "USER",
		),
	];
}

/** O dono já informou este campo (habilita "Limpar"). */
export function isInformed(p: Pick<InvestmentPositionDto, "terms">, field: TermsField): boolean {
	const t = p.terms;
	if (field === "rate") return t?.rate?.source === "USER";
	if (field === "invested") return t?.invested?.source === "USER";
	return t?.startDate?.source === "USER";
}

/** "Banco: 102% do CDI" quando o banco informa um valor diferente do efetivo; `null` caso contrário. */
export function bankLine(
	p: Pick<InvestmentPositionDto, "terms">,
	field: TermsField,
	hidden: boolean,
): string | null {
	const t = p.terms;
	const bank = t?.bank;
	if (!t || !bank) return null;
	if (field === "rate") {
		if (!bank.rate) return null;
		const same = t.rate?.kind === bank.rate.kind && t.rate.bps === bank.rate.bps;
		return same ? null : `Banco: ${rateLabel(bank.rate.kind, bank.rate.bps)}`;
	}
	if (field === "invested") {
		if (bank.invested === null) return null;
		return t.invested?.cents === bank.invested
			? null
			: `Banco: ${money(bank.invested, hidden, { sign: "never" })}`;
	}
	if (bank.startDate === null) return null;
	return t.startDate?.date === bank.startDate ? null : `Banco: ${dayMonth(bank.startDate)}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// PUT
// ---------------------------------------------------------------------------------------------------------------------

/** O que o dono já informou (origem USER), no formato do corpo do PUT. */
export function informedTerms(p: Pick<InvestmentPositionDto, "terms">): TermsPutBody {
	const t = p.terms;
	const body: TermsPutBody = {};
	if (t?.rate?.source === "USER") {
		body.rateKind = t.rate.kind;
		body.rateBps = t.rate.bps;
	}
	if (t?.invested?.source === "USER") body.investedCents = t.invested.cents;
	if (t?.startDate?.source === "USER") body.startDate = t.startDate.date;
	return body;
}

export type TermsChange =
	| { field: "rate"; value: { kind: InvestmentRateKind; bps: number } | null }
	| { field: "invested"; value: number | null }
	| { field: "startDate"; value: string | null };

/**
 * O PUT SUBSTITUI tudo: manda o que o dono já informou mais a alteração (`null` limpa só aquele campo). Sem nada, `{}`
 * (limpa tudo).
 */
export function buildTermsBody(p: Pick<InvestmentPositionDto, "terms">, change: TermsChange): TermsPutBody {
	const body = informedTerms(p);
	if (change.field === "rate") {
		delete body.rateKind;
		delete body.rateBps;
		if (change.value) {
			body.rateKind = change.value.kind;
			body.rateBps = change.value.bps;
		}
	} else if (change.field === "invested") {
		delete body.investedCents;
		if (change.value !== null) body.investedCents = change.value;
	} else {
		delete body.startDate;
		if (change.value !== null) body.startDate = change.value;
	}
	return body;
}

/** Dinheiro do campo em centavos, só com texto (nunca float); `null` se vazio, inválido ou zero. */
export function parseInvested(text: string): number | null {
	const v = parseReais(text);
	return typeof v === "number" && v > 0 ? v : null;
}

/** Data (já convertida de dd/mm/aaaa) que não pode ser futura. */
export function startDateProblem(date: string | null, today: string): string | null {
	if (date === null) return "Data inválida";
	return date > today ? "Data futura" : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Rendimento esperado
// ---------------------------------------------------------------------------------------------------------------------

export interface ExpectedLine {
	label: string;
	value: string;
	tone: "primary" | "secondary" | "warning";
}

export type ExpectedView =
	| { kind: "none" }
	| { kind: "unavailable"; text: string }
	| { kind: "ready"; lines: ExpectedLine[]; until: string; approx: boolean; a11y: string };

const UNAVAILABLE_TEXT: Record<string, string> = {
	ipca_unsupported: "IPCA ainda não",
	cdi_unavailable: "CDI indisponível",
};

/** O que o detalhe mostra de rendimento esperado. Todo número vem pronto do servidor. */
export function expectedView(
	p: Pick<InvestmentPositionDto, "termsApplicable" | "expected" | "expectedUnavailable" | "gapCents">,
	hidden: boolean,
): ExpectedView {
	if (p.termsApplicable !== true) return { kind: "none" };
	const e = p.expected;
	if (!e) {
		const u = p.expectedUnavailable;
		return u ? { kind: "unavailable", text: UNAVAILABLE_TEXT[u.code] ?? "Indisponível" } : { kind: "none" };
	}
	const lines: ExpectedLine[] = [
		{ label: "Esperado", value: money(e.grossCents, hidden, { sign: "never" }), tone: "primary" },
	];
	if (p.gapCents !== null && p.gapCents !== undefined) {
		lines.push({
			label: "Diferença",
			value: money(p.gapCents, hidden, { sign: "always" }),
			tone: p.gapCents < 0 ? "warning" : "primary",
		});
	}
	if (e.netYieldCents !== null) {
		lines.push({
			label: "Líquido est.",
			value: money(e.netYieldCents, hidden, { sign: "always" }),
			tone: "secondary",
		});
	}
	const until = `até ${dayMonth(e.asOf)}`;
	const approx = e.warnings.length > 0;
	return {
		kind: "ready",
		lines,
		until,
		approx,
		a11y: `${lines.map((l) => `${l.label} ${l.value}`).join(", ")}, ${until}${approx ? ", aproximado" : ""}`,
	};
}

// ---------------------------------------------------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------------------------------------------------

/** Chaves de consulta que mudam quando as condições mudam: lista, detalhe e evolução (todas começam com o servidor). */
export function isInvestmentsKey(key: readonly unknown[], baseUrl: string): boolean {
	return (
		key[0] === baseUrl &&
		(key[1] === "investments" || key[1] === "investment" || key[1] === "investments-evolution")
	);
}
