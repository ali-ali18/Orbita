import { z } from "zod";
import { idSchema, timestampSchema } from "./finance-primitives.ts";

/*
 * Regras de categoria aprendidas com as correções do dono. Tudo aqui é função pura: o servidor deriva o "nome do
 * estabelecimento" da descrição do lançamento, guarda esse padrão e o sync reaplica nos lançamentos novos.
 */

export const SOURCE_CATEGORY_MAX = 120;
export const MERCHANT_NAME_MAX = 120;
export const CATEGORY_RULE_PATTERN_MAX = 60;
export const CATEGORY_RULE_PATTERN_MIN = 3;
/** Teto de regras: o dono é uma pessoa; passar disso é erro de uso, não dado. */
export const MAX_CATEGORY_RULES = 1000;

/** Texto de fora (categoria do banco, nome do estabelecimento) saneado: sem controle, espaços únicos, limitado. */
export function cleanExternalLabel(value: string | null | undefined, max: number): string | null {
	if (value === null || value === undefined) return null;
	const text = value
		.replace(/\p{Cf}/gu, "")
		.replace(/\p{Cc}/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (text.length === 0) return null;
	return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export const cleanSourceCategory = (value: string | null | undefined) =>
	cleanExternalLabel(value, SOURCE_CATEGORY_MAX);
export const cleanMerchantName = (value: string | null | undefined) =>
	cleanExternalLabel(value, MERCHANT_NAME_MAX);

/** Prefixos de banco que não dizem quem é o estabelecimento. Do mais longo para o mais curto. */
const PREFIXES: readonly string[] = [
	"transferencia enviada pelo pix",
	"transferencia recebida pelo pix",
	"transferencia enviada",
	"transferencia recebida",
	"transferencia pix",
	"pix transferencia",
	"pagamento de boleto",
	"pagamento boleto",
	"pagamento efetuado",
	"pagamento pix",
	"compra no credito",
	"compra no debito",
	"compra credito",
	"compra debito",
	"compra cartao",
	"debito automatico",
	"pix qr code",
	"qr code",
	"pix enviado",
	"pix enviada",
	"pix recebido",
	"pix recebida",
	"ted enviada",
	"ted recebida",
	"pagamento",
	"compra",
	"pgto",
	"debito",
	"credito",
	"pix",
	"ted",
	"doc",
	"pag",
];

const DATE = /\b\d{1,2}\s*\/\s*\d{1,2}(\s*\/\s*\d{2,4})?\b/g;
const INSTALLMENT_WORDS = /\bparcela\s+\d+\s+de\s+\d+\b/g;

/**
 * "Nome do estabelecimento" de uma descrição de extrato: minúsculo, sem acento, sem prefixo de banco ("pix enviado -",
 * "compra no debito"), sem data, parcela ("3/10"), números longos nem códigos. Vazio se não sobra nada.
 *
 * "Pix enviado - Rei Dos Lanches 12/11" → "rei dos lanches".
 */
export function normalizeMerchantName(raw: string | null | undefined): string {
	let text = (raw ?? "")
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(INSTALLMENT_WORDS, " ")
		.replace(DATE, " ")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
	// Prefixos podem vir empilhados ("pix enviado pagamento ..."): tira enquanto houver.
	for (let changed = true; changed; ) {
		changed = false;
		for (const prefix of PREFIXES) {
			if (text === prefix) return "";
			if (text.startsWith(`${prefix} `)) {
				text = text.slice(prefix.length + 1).trim();
				changed = true;
				break;
			}
		}
	}
	const words = text.split(" ").filter((w) => {
		if (w === "") return false;
		if (/^\d{3,}$/.test(w)) return false; // número longo (CPF mascarado, conta, protocolo)
		if (/\d/.test(w) && w.length >= 6) return false; // código misto ("x8f2k91")
		return true;
	});
	let out = words.join(" ");
	if (out.length > CATEGORY_RULE_PATTERN_MAX) {
		out = out.slice(0, CATEGORY_RULE_PATTERN_MAX);
		out = out.includes(" ") ? out.slice(0, out.lastIndexOf(" ")) : out;
	}
	return out.trim();
}

/** Padrão de uma regra a partir dos textos do lançamento (nome do estabelecimento primeiro). `null` se não serve. */
export function derivePattern(...texts: Array<string | null | undefined>): string | null {
	for (const text of texts) {
		const name = normalizeMerchantName(text);
		if (name.length >= CATEGORY_RULE_PATTERN_MIN) return name;
	}
	return null;
}

/** O padrão aparece no nome como palavras inteiras ("uber" casa "uber trip", não "suberbo")? */
export function patternMatches(pattern: string, name: string): boolean {
	if (pattern.length === 0 || name.length === 0) return false;
	return ` ${name} `.includes(` ${pattern} `);
}

export interface CategoryRuleLike {
	pattern: string;
	categoryId: string;
}

/** A regra de padrão mais longo (mais específico) que casa com algum dos textos do lançamento. */
export function pickCategoryRule<R extends CategoryRuleLike>(
	rules: readonly R[],
	...texts: Array<string | null | undefined>
): R | null {
	const names = texts.map(normalizeMerchantName).filter((n) => n !== "");
	let best: R | null = null;
	for (const rule of rules) {
		if (!names.some((n) => patternMatches(rule.pattern, n))) continue;
		if (best === null || rule.pattern.length > best.pattern.length) best = rule;
	}
	return best;
}

// ------------------------------------------------------------------ API

export const categoryRuleDto = z.object({
	id: idSchema,
	pattern: z.string(),
	categoryId: idSchema,
	createdAt: timestampSchema,
});
export type CategoryRuleDto = z.infer<typeof categoryRuleDto>;

/** Cria a regra a partir de um lançamento já corrigido: o servidor deriva o padrão da descrição dele. */
export const categoryRuleCreateBody = z
	.object({
		transactionId: idSchema,
		categoryId: idSchema,
		applyToExisting: z.boolean().optional(),
	})
	.strict();
export type CategoryRuleCreateBody = z.infer<typeof categoryRuleCreateBody>;
