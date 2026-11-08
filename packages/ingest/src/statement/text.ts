import { DESCRIPTION_MAX } from "@orbita/shared";

/** Minúsculo, sem acento e com espaços simples: para comparar nomes de coluna e texto. */
export const plain = (value: string): string =>
	value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// biome-ignore lint/suspicious/noControlCharactersInRegex: é justamente o que se quer tirar
const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿]/g;

/** Texto de arquivo vira texto de tela: sem caracteres de controle, espaços simples, tamanho limitado. */
export function cleanText(value: string, max: number = DESCRIPTION_MAX): string {
	const text = value.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
	return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Trecho curto para a lista "não entendi estas linhas". */
export const excerpt = (value: string): string => cleanText(value, 120);

/**
 * Bytes → texto. UTF-8 estrito; se não for UTF-8 válido (extratos do Itaú e do Bradesco costumam vir em
 * Windows-1252), lê como Windows-1252. Nunca lança.
 */
export function decodeBytes(bytes: Uint8Array): string {
	try {
		return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes).replace(/^﻿/, "");
	} catch {
		return new TextDecoder("windows-1252").decode(bytes);
	}
}

/** "Saldo do dia", "SALDO ANTERIOR", "Saldo final": linhas de saldo não são lançamentos. */
export const isBalanceLabel = (description: string): boolean =>
	/^(saldo|sdo|s a l d o|total (da )?(fatura|compras))\b/.test(plain(description));
