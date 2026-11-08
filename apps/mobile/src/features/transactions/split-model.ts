import {
	type Cents,
	checkSplit,
	evenSplit,
	formatBRL,
	MAX_SPLIT_PARTS,
	MIN_SPLIT_PARTS,
	parseBRL,
} from "@orbita/core";
import { type TransactionSplitBody, transactionSplitBody } from "@orbita/shared";
import type { DetailTransaction } from "./detail-model.ts";

/*
 * Lógica pura de "Dividir" no detalhe do lançamento. As contas (soma, o que falta, partes iguais) são do engine
 * (`@orbita/core`); aqui só se converte o que o dono digitou e se monta o pedido. O servidor confere de novo.
 */

/** Aviso no detalhe de uma parte de lançamento dividido. */
export const SPLIT_NOTE = "Parte de um lançamento dividido em categorias.";

/** Despesa ou receita avulsa, com pelo menos 1 centavo por parte. Parcela, transferência e estorno não dividem. */
export function canSplit(t: Pick<DetailTransaction, "kind" | "installmentGroupId" | "amountCents">): boolean {
	return (
		(t.kind === "expense" || t.kind === "income") &&
		t.installmentGroupId === null &&
		t.amountCents >= MIN_SPLIT_PARTS
	);
}

export interface SplitDraftPart {
	/** O que está no campo ("30,00"); a conversão para centavos é `parseAmountText`. */
	amountText: string;
	categoryId: string | null;
}

export interface SplitDraft {
	parts: SplitDraftPart[];
}

/** "46,90" (sem o "R$"), o formato do campo de valor. */
export function amountToText(cents: Cents): string {
	return formatBRL(cents, { sign: "never" }).replace(/^R\$\s*/, "");
}

/** Centavos do que foi digitado ("30", "30,5", "1.234,56"); `null` se vazio ou não é dinheiro em pt-BR. */
export function parseAmountText(text: string): Cents | null {
	if (text.trim() === "") return null;
	try {
		return parseBRL(text);
	} catch {
		return null;
	}
}

/** Partes iguais (o resto dos centavos na primeira), mantendo as categorias que já estavam escolhidas. */
function evenParts(totalCents: Cents, categories: readonly (string | null)[]): SplitDraftPart[] {
	return evenSplit(totalCents, categories.length).map((cents, i) => ({
		amountText: amountToText(cents),
		categoryId: categories[i] ?? null,
	}));
}

/** Começa em duas partes iguais; a primeira já fica com a categoria atual do lançamento. */
export function initialSplitDraft(totalCents: Cents, categoryId: string | null): SplitDraft {
	return { parts: evenParts(totalCents, [categoryId, null]) };
}

export function canAddPart(totalCents: Cents, draft: SplitDraft): boolean {
	return draft.parts.length < MAX_SPLIT_PARTS && totalCents >= draft.parts.length + 1;
}

/** Mais uma parte: refaz em partes iguais (o dono ajusta depois). Não passa do máximo nem de 1 centavo por parte. */
export function addPart(totalCents: Cents, draft: SplitDraft): SplitDraft {
	if (!canAddPart(totalCents, draft)) return draft;
	return { parts: evenParts(totalCents, [...draft.parts.map((p) => p.categoryId), null]) };
}

export function canRemovePart(draft: SplitDraft): boolean {
	return draft.parts.length > MIN_SPLIT_PARTS;
}

/** Tira uma parte e refaz em partes iguais. Nunca deixa menos de duas. */
export function removePart(totalCents: Cents, draft: SplitDraft, index: number): SplitDraft {
	if (!canRemovePart(draft)) return draft;
	return {
		parts: evenParts(
			totalCents,
			draft.parts.filter((_, i) => i !== index).map((p) => p.categoryId),
		),
	};
}

export function updatePart(draft: SplitDraft, index: number, patch: Partial<SplitDraftPart>): SplitDraft {
	return { parts: draft.parts.map((p, i) => (i === index ? { ...p, ...patch } : p)) };
}

export type SplitEvaluation =
	| { ok: true; differenceCents: 0; message: null }
	/** `differenceCents` é `null` enquanto algum campo não é um valor válido. */
	| { ok: false; differenceCents: Cents | null; message: string };

/** Confere o rascunho com o engine: soma exata, 2 a 20 partes, nenhuma zerada. */
export function evaluateSplit(totalCents: Cents, draft: SplitDraft): SplitEvaluation {
	const cents = draft.parts.map((p) => parseAmountText(p.amountText));
	if (cents.some((c) => c === null)) {
		return { ok: false, differenceCents: null, message: "Confira o valor de cada parte." };
	}
	const check = checkSplit(totalCents, cents as Cents[]);
	return check.ok
		? { ok: true, differenceCents: 0, message: null }
		: { ok: false, differenceCents: check.differenceCents, message: check.message };
}

/** "Falta R$ 6,90", "Passou R$ 3,10" ou "Fecha certinho"; o valor vem do engine. */
export function differenceLabel(evaluation: SplitEvaluation): string {
	const diff = evaluation.differenceCents;
	if (diff === null) return "Informe o valor de cada parte";
	if (diff === 0) return evaluation.ok ? "Fecha certinho" : "Confira as partes";
	return diff > 0
		? `Falta ${formatBRL(diff, { sign: "never" })}`
		: `Passou ${formatBRL(-diff, { sign: "never" })}`;
}

export type SplitRequest = { ok: true; body: TransactionSplitBody } | { ok: false; message: string };

/** Corpo do pedido, validado com o mesmo schema da API. */
export function buildSplitRequest(totalCents: Cents, draft: SplitDraft): SplitRequest {
	const evaluation = evaluateSplit(totalCents, draft);
	if (!evaluation.ok) return { ok: false, message: evaluation.message };
	const parsed = transactionSplitBody.safeParse({
		parts: draft.parts.map((p) => ({
			amountCents: parseAmountText(p.amountText),
			...(p.categoryId ? { categoryId: p.categoryId } : {}),
		})),
	});
	return parsed.success
		? { ok: true, body: parsed.data }
		: { ok: false, message: parsed.error.issues[0]?.message ?? "Confira as partes da divisão." };
}
