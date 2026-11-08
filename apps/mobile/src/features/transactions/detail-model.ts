import type { Cents, LocalDate } from "@orbita/core";
import { NOTE_MAX, type TransactionApiUpdateBody, transactionApiUpdateBody } from "@orbita/shared";
import { monthName } from "../../lib/format.ts";

/*
 * Lógica pura da tela "Detalhe do lançamento": o que dá para editar conforme a origem e o tipo,
 * rótulos em pt-BR e a montagem do PATCH (só o que mudou). Nenhuma conta aqui: valores vêm do servidor.
 */

export type DetailSource = "manual" | "notification" | "pluggy" | "receipt" | "import";
export type DetailKind = "expense" | "income" | "transfer" | "card_payment" | "refund" | "investment";

export interface DetailTransaction {
	id: string;
	kind: DetailKind;
	amountCents: Cents;
	date: LocalDate;
	description: string;
	categoryId: string | null;
	accountId: string | null;
	cardId: string | null;
	invoiceMonth: string | null;
	installmentGroupId: string | null;
	installmentNumber: number | null;
	installmentCount: number | null;
	status: "pending" | "confirmed";
	source: DetailSource;
	note: string | null;
	/** Nome do estabelecimento e categoria que o banco mandou (só importados). */
	merchantName?: string | null | undefined;
	sourceCategory?: string | null | undefined;
	/** Partes de um lançamento dividido compartilham o id. */
	splitGroupId?: string | null | undefined;
}

export interface Editable {
	description: true;
	note: true;
	/** Categoria só faz sentido em despesa, receita e estorno. */
	category: boolean;
	/** Valor, data e cartão: o app não expõe (vêm do banco, ou o parcelamento nasce fechado). */
	amountAndDate: boolean;
	/** Aviso para o usuário sobre o que não muda aqui; `null` se nada está travado. */
	lockNote: string | null;
}

export function isInstallment(t: Pick<DetailTransaction, "installmentGroupId">): boolean {
	return t.installmentGroupId !== null;
}

export function editableFields(
	t: Pick<DetailTransaction, "kind" | "source" | "installmentGroupId">,
): Editable {
	const category = t.kind === "expense" || t.kind === "income" || t.kind === "refund";
	if (t.source === "pluggy") {
		return {
			description: true,
			note: true,
			category,
			amountAndDate: false,
			lockNote: "Valor e data vêm do banco e não mudam aqui. Categoria, descrição e nota você pode ajustar.",
		};
	}
	if (isInstallment(t)) {
		return {
			description: true,
			note: true,
			category,
			amountAndDate: false,
			lockNote: "Para mudar valor, data ou cartão de um parcelamento, apague e lance de novo.",
		};
	}
	return { description: true, note: true, category, amountAndDate: true, lockNote: null };
}

// ------------------------------------------------------------------ rótulos

/** "3/10" para parcela; "À vista" para o resto. */
export function installmentText(
	t: Pick<DetailTransaction, "installmentNumber" | "installmentCount">,
): string {
	return t.installmentNumber !== null && t.installmentCount !== null
		? `${t.installmentNumber}/${t.installmentCount}`
		: "À vista";
}

/** "Dezembro" (ou "Dezembro de 2027" se não for o ano de hoje). `null` sem fatura. */
export function invoiceText(invoiceMonth: string | null, today: LocalDate): string | null {
	if (invoiceMonth === null) return null;
	const name = monthName(invoiceMonth);
	return invoiceMonth.slice(0, 4) === today.slice(0, 4) ? name : `${name} de ${invoiceMonth.slice(0, 4)}`;
}

export function sourceTitle(source: DetailSource): string {
	switch (source) {
		case "manual":
			return "Lançado por você";
		case "notification":
			return "Notificação do banco";
		case "pluggy":
			return "Importado do Meu Pluggy";
		case "receipt":
			return "Lido de um comprovante";
		case "import":
			return "Extrato importado";
	}
}

export function sourceCaption(source: DetailSource): string {
	switch (source) {
		case "manual":
			return "Digitado no app";
		case "notification":
			return "Chegou pela notificação do aplicativo do banco";
		case "pluggy":
			return "Sincronizado do seu banco";
		case "receipt":
			return "Chegou por foto ou arquivo";
		case "import":
			return "Veio de um arquivo de extrato";
	}
}

export function statusText(status: DetailTransaction["status"]): { title: string; caption: string } {
	return status === "confirmed"
		? { title: "Confirmado", caption: "Você já conferiu este lançamento" }
		: { title: "Para revisar", caption: "Ainda não foi confirmado" };
}

export function kindTitle(kind: DetailKind): string {
	switch (kind) {
		case "expense":
			return "Saída";
		case "income":
			return "Entrada";
		case "refund":
			return "Estorno";
		case "transfer":
			return "Transferência";
		case "card_payment":
			return "Pagamento de fatura";
		case "investment":
			return "Investimento";
	}
}

// -------------------------------------------------------------------- PATCH

export interface DetailDraft {
	description?: string;
	/** Texto da nota; vazio limpa. */
	note?: string;
	/** `null` limpa a categoria. */
	categoryId?: string | null;
}

export type PatchResult =
	| { ok: true; body: TransactionApiUpdateBody | null }
	| { ok: false; message: string };

/**
 * Corpo do PATCH só com o que mudou (campo ausente fica como está; `null` limpa). Valida com o mesmo
 * schema da API. `body: null` = nada mudou, não precisa chamar o servidor. Status e mês de orçamento
 * nunca saem daqui; valor, data e cartão também não.
 */
export function buildPatch(t: DetailTransaction, draft: DetailDraft): PatchResult {
	const editable = editableFields(t);
	const body: Record<string, unknown> = {};

	if (draft.description !== undefined) {
		const description = draft.description.trim();
		if (description === "") return { ok: false, message: "Informe a descrição do lançamento." };
		if (description !== t.description) body.description = description;
	}
	if (draft.note !== undefined) {
		const note = draft.note.trim();
		if (note.length > NOTE_MAX) return { ok: false, message: `A nota passa de ${NOTE_MAX} letras.` };
		const next = note === "" ? null : note;
		if (next !== t.note) body.note = next;
	}
	if (draft.categoryId !== undefined && draft.categoryId !== t.categoryId) {
		if (!editable.category) return { ok: false, message: "Este tipo de lançamento não tem categoria." };
		body.categoryId = draft.categoryId;
	}

	if (Object.keys(body).length === 0) return { ok: true, body: null };
	const parsed = transactionApiUpdateBody.safeParse(body);
	return parsed.success
		? { ok: true, body: parsed.data }
		: { ok: false, message: parsed.error.issues[0]?.message ?? "Confira os dados do lançamento." };
}

// ------------------------------------------------------------------- apagar

export type DeleteScope = "item" | "group";

export interface DeleteChoice {
	scope: DeleteScope;
	label: string;
}

/** O que oferecer ao apagar: parcela pergunta "só esta" ou "todo o parcelamento"; o resto só apaga. */
export function deleteChoices(
	t: Pick<DetailTransaction, "installmentGroupId" | "installmentCount">,
): DeleteChoice[] {
	if (t.installmentGroupId === null) return [{ scope: "item", label: "Apagar lançamento" }];
	return [
		{ scope: "item", label: "Só esta parcela" },
		{
			scope: "group",
			label: t.installmentCount
				? `Todo o parcelamento (${t.installmentCount} parcelas)`
				: "Todo o parcelamento",
		},
	];
}

export function deleteMessage(installment: boolean): string {
	return !installment
		? "O lançamento some do histórico e dos totais. Não dá para desfazer."
		: "Esta compra é parcelada. Escolha o que apagar. Não dá para desfazer.";
}

// ------------------------------------------------- aplicar a todos da loja

/** Só consumo (despesa e estorno) tem regra de categoria por loja; e precisa ter categoria escolhida. */
export function canApplyToAll(t: Pick<DetailTransaction, "kind" | "categoryId">): boolean {
	return (t.kind === "expense" || t.kind === "refund") && t.categoryId !== null;
}

/** Nome da loja como o servidor o usa para a regra: o do banco, senão a descrição. */
export function storeNameOf(t: Pick<DetailTransaction, "merchantName" | "description">): string {
	return t.merchantName?.trim() || t.description.trim();
}

export function applyAllLabel(t: Pick<DetailTransaction, "merchantName" | "description">): string {
	return `Aplicar a todos de ${storeNameOf(t)}`;
}

/** Resultado do "Aplicar a todos" (`updated` = quantos OUTROS lançamentos mudaram). */
export function appliedMessage(updated: number): string {
	if (updated <= 0) return "Nenhum outro lançamento para atualizar.";
	return updated === 1 ? "1 lançamento atualizado" : `${updated} lançamentos atualizados`;
}

/** "Categoria no banco: Shopping › Eletrônicos", ou `null` se o banco não mandou. */
export function bankCategoryLabel(t: Pick<DetailTransaction, "sourceCategory">): string | null {
	const text = t.sourceCategory?.trim();
	return text ? `Categoria no banco: ${text}` : null;
}
