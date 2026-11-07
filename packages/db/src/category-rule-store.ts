import {
	CATEGORY_RULE_PATTERN_MAX,
	CATEGORY_RULE_PATTERN_MIN,
	MAX_CATEGORY_RULES,
	normalizeMerchantName,
} from "@orbita/shared";
import { invalid } from "./errors.ts";

/** Regra aprendida com a correção do dono: nome de estabelecimento (já normalizado) → categoria. */
export interface CategoryRuleRecord {
	id: string;
	/** Texto normalizado por `normalizeMerchantName` (minúsculo, sem acento, sem prefixo de banco nem códigos). */
	pattern: string;
	categoryId: string;
	createdAt: Date;
}

export const RULE_LIMIT_MESSAGE = `Há regras demais (o máximo é ${MAX_CATEGORY_RULES}). Apague algumas.`;

/** O padrão já vem normalizado de quem chama; aqui só se confere (a regra no banco é sempre a forma canônica). */
export function cleanRulePattern(pattern: string): string {
	if (typeof pattern !== "string" || normalizeMerchantName(pattern) !== pattern) {
		throw invalid("O padrão da regra deve estar normalizado (minúsculo, sem acento, sem códigos).");
	}
	if (pattern.length < CATEGORY_RULE_PATTERN_MIN || pattern.length > CATEGORY_RULE_PATTERN_MAX) {
		throw invalid(
			`O padrão da regra deve ter de ${CATEGORY_RULE_PATTERN_MIN} a ${CATEGORY_RULE_PATTERN_MAX} letras.`,
		);
	}
	return pattern;
}

export interface CategoryRuleStore {
	/** Mais antigas primeiro. */
	list(): Promise<CategoryRuleRecord[]>;
	get(id: string): Promise<CategoryRuleRecord | null>;
	/**
	 * Cria a regra ou, se o padrão já existe, troca a categoria dela (mesma id). `bad_reference` se a categoria não
	 * existe ou está arquivada; `invalid` se o padrão não está normalizado ou passou do limite de regras.
	 */
	upsert(pattern: string, categoryId: string): Promise<CategoryRuleRecord>;
	/** `true` se apagou agora. */
	delete(id: string): Promise<boolean>;
}
