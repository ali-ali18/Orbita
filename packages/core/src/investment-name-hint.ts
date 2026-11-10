import { type InvestmentRateKind, RATE_LIMITS_BPS } from "./investment-terms.ts";

/*
 * Pista pelo nome do produto ("CDB 102% do CDI"). Função pura e CONSERVADORA: só reconhece formatos inequívocos e,
 * na dúvida (dois números, dois tipos de taxa, formato estranho), devolve `null`. O resultado é SUGESTÃO a confirmar
 * (origem NAME_HINT), nunca verdade: não entra em nenhum cálculo até o dono confirmar.
 *
 * O nome vem do banco e é dado NÃO confiável: o texto só é lido por expressões regulares com repetição limitada
 * (sem backtracking perigoso) e nunca interpretado como instrução.
 */

export interface RateNameHint {
	kind: InvestmentRateKind;
	/** Centésimos de ponto percentual (102% = 10200). */
	bps: number;
	/** O trecho do nome que originou a pista (para a tela mostrar "achei '102% do CDI' no nome"). */
	matched: string;
}

/** Faixas em que uma pista é plausível (fora delas, prefere não sugerir a sugerir errado), em centésimos de ponto %. */
export const NAME_HINT_RANGES_BPS: Record<InvestmentRateKind, { min: number; max: number }> = {
	CDI_PERCENT: { min: 5_000, max: 25_000 },
	PREFIXED: { min: 400, max: 3_000 },
	IPCA_PLUS: { min: 50, max: 1_500 },
};

/** "13,5" ou "13.5" ou "102" para centésimos (1350, 10200). `null` se não é um número simples de até 2 casas. */
export function percentToBps(text: string): number | null {
	const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text);
	if (!m) return null;
	const whole = Number(m[1]);
	const frac = Number((m[2] ?? "").padEnd(2, "0"));
	return whole * 100 + frac;
}

// Número: 1 a 3 dígitos, no máximo 2 casas, sem dígito colado depois ("1.000" não é "1.00"+"0") nem antes ("2027").
const NUM = String.raw`(?<![\d.,+])(\d{1,3}(?:[.,]\d{1,2})?)(?![\d])`;
const CDI_PERCENT_RE = new RegExp(String.raw`${NUM}\s{0,2}%\s{0,2}(?:d[oae]s?\s{1,3})?CDI(?![A-Za-z])`, "gi");
const IPCA_PLUS_RE = new RegExp(String.raw`IPCA\s{0,2}\+\s{0,2}${NUM}\s{0,2}%`, "gi");
const PREFIXED_WORD_RE = /(?<![A-Za-zÀ-ÿ])(?:PREFIXAD[OA]|PRE-?FIXAD[OA]|PR[EÉ])(?![A-Za-zÀ-ÿ])/gi;
// Depois da palavra "pré": no máximo 12 caracteres sem dígito e a taxa com "%" (e "a.a."/"ao ano" opcional).
const PREFIXED_RATE_RE = new RegExp(
	String.raw`^[^\d]{0,12}${NUM}\s{0,2}%(?:\s{0,2}(?:a\.?\s?a\.?|ao\s{1,3}ano))?`,
	"i",
);

const matchesOf = (re: RegExp, text: string): RegExpExecArray[] => [...text.matchAll(re)];

/**
 * Extrai a taxa do nome. Exemplos que casam: "CDB 102% do CDI", "LCI 95% CDI", "CDB PRE 13,5% a.a.", "IPCA + 6,2%".
 * Não casam (e voltam `null`): "CDI + 2%" (spread, não é % do CDI), "Tesouro IPCA+ 2035" (sem taxa), "CDB Liquidez Diária",
 * "Fundo DI 100% referenciado" (sem CDI no nome), mais de uma taxa, ou número fora da faixa plausível.
 */
export function rateHintFromName(name: string | null | undefined): RateNameHint | null {
	if (typeof name !== "string") return null;
	const text = name.trim().slice(0, 200);
	if (text === "") return null;

	const found: RateNameHint[] = [];

	for (const m of matchesOf(CDI_PERCENT_RE, text)) {
		const bps = percentToBps(m[1] as string);
		if (bps !== null) found.push({ kind: "CDI_PERCENT", bps, matched: m[0].trim() });
	}
	for (const m of matchesOf(IPCA_PLUS_RE, text)) {
		const bps = percentToBps(m[1] as string);
		if (bps !== null) found.push({ kind: "IPCA_PLUS", bps, matched: m[0].trim() });
	}
	// Prefixado exige a palavra ("PRE", "PRÉ", "PREFIXADO") antes da taxa. Se o nome também fala de CDI/IPCA/Selic,
	// é outro tipo de produto ou está ambíguo: o achado extra faz o total passar de um e nada é sugerido.
	const mentionsIndex = /CDI|IPCA|SELIC/i.test(text);
	for (const w of matchesOf(PREFIXED_WORD_RE, text)) {
		const after = text.slice((w.index ?? 0) + w[0].length);
		const r = PREFIXED_RATE_RE.exec(after);
		const bps = r ? percentToBps(r[1] as string) : null;
		if (r && bps !== null) {
			found.push({ kind: "PREFIXED", bps, matched: `${w[0]}${r[0]}`.trim() });
			if (mentionsIndex) found.push({ kind: "PREFIXED", bps, matched: "indexador no nome" });
		}
	}

	// Dois achados (mesmo iguais) = formato duvidoso: não sugere.
	if (found.length !== 1) return null;
	const hint = found[0] as RateNameHint;
	const range = NAME_HINT_RANGES_BPS[hint.kind];
	const limit = RATE_LIMITS_BPS[hint.kind];
	if (hint.bps < range.min || hint.bps > range.max || hint.bps < limit.min || hint.bps > limit.max)
		return null;
	return hint;
}

/** Tipos de produto de renda fixa que o nome do produto entrega por uma palavra inteira ("LCI", "CDB"). */
export const PRODUCT_KINDS = [
	"CDB",
	"RDB",
	"LC",
	"LF",
	"LCI",
	"LCA",
	"CRI",
	"CRA",
	"LIG",
	"TREASURY",
	"DEBENTURE",
] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

const PRODUCT_WORD_RE = /(?<![A-Za-z0-9])(CDB|RDB|LCI|LCA|CRI|CRA|LIG|LF|LC)(?![A-Za-z0-9])/gi;

/**
 * Tipo do produto: o subtipo do banco quando é conhecido; senão uma palavra inteira do nome ("LCI Banco X"), e só se
 * houver UMA (duas siglas diferentes = ambíguo). `null` = desconhecido.
 */
export function productKindOf(subtype: string | null, name: string | null): ProductKind | null {
	const s = (subtype ?? "").trim().toUpperCase();
	if ((PRODUCT_KINDS as readonly string[]).includes(s)) return s as ProductKind;
	if (typeof name !== "string") return null;
	const words = new Set(
		matchesOf(PRODUCT_WORD_RE, name.slice(0, 200)).map((m) => (m[1] as string).toUpperCase()),
	);
	return words.size === 1 ? ([...words][0] as ProductKind) : null;
}
