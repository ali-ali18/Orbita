import type { TransactionKindValue } from "./finance-primitives.ts";
import { isCents, isLocalDate, isMonthKey, MAX_CENTS, MAX_INSTALLMENT_COUNT } from "./finance-primitives.ts";

/** O que as regras de um lançamento olham. Ausente = `undefined` ou `null`. */
export interface TransactionShape {
	kind: TransactionKindValue;
	amountCents: number;
	date: string;
	description: string;
	budgetMonth?: string | null | undefined;
	invoiceMonth?: string | null | undefined;
	accountId?: string | null | undefined;
	cardId?: string | null | undefined;
	counterpartAccountId?: string | null | undefined;
	refundOfId?: string | null | undefined;
	installmentGroupId?: string | null | undefined;
	installmentNumber?: number | null | undefined;
	installmentCount?: number | null | undefined;
	note?: string | null | undefined;
}

export const DESCRIPTION_MAX = 200;
export const NOTE_MAX = 1000;

export const INCOME_ON_CARD_MESSAGE =
	"Receita entra em uma conta, não no cartão. Para cashback ou devolução, lance um estorno.";

export const INVESTMENT_ON_CARD_MESSAGE = "Aplicação sai de uma conta, não do cartão.";

const has = (v: unknown) => v !== undefined && v !== null;

/**
 * Invariantes de um lançamento, a ÚNICA fonte: os dois stores (Prisma e memória) e os
 * schemas Zod chamam esta função, então a mensagem é a mesma em qualquer lugar.
 * Devolve a primeira violação em pt-BR, ou `null`. (Que o estorno aponte para uma despesa
 * existente depende do banco e fica no store.)
 */
export function transactionInvariantError(t: TransactionShape): string | null {
	if (!isCents(t.amountCents) || t.amountCents <= 0 || t.amountCents > MAX_CENTS) {
		return "O valor deve ser um inteiro positivo, em centavos.";
	}
	if (!isLocalDate(t.date)) return "Data inválida (use AAAA-MM-DD).";
	if (has(t.budgetMonth) && !isMonthKey(t.budgetMonth)) return "Mês do orçamento inválido (use AAAA-MM).";
	if (has(t.invoiceMonth) && !isMonthKey(t.invoiceMonth)) return "Mês da fatura inválido (use AAAA-MM).";
	const description = t.description.trim();
	if (description.length === 0) return "Informe a descrição do lançamento.";
	if (description.length > DESCRIPTION_MAX) return `A descrição passa de ${DESCRIPTION_MAX} letras.`;
	if (has(t.note) && (t.note as string).length > NOTE_MAX) return `A observação passa de ${NOTE_MAX} letras.`;

	const hasAccount = has(t.accountId);
	const hasCard = has(t.cardId);
	const hasCounterpart = has(t.counterpartAccountId);

	switch (t.kind) {
		case "expense":
		case "income":
		case "refund":
			if (t.kind === "income" && hasCard) return INCOME_ON_CARD_MESSAGE;
			if (hasAccount === hasCard) return "Informe a conta ou o cartão (apenas um dos dois).";
			if (hasCounterpart) return "A conta de destino só vale para transferência.";
			break;
		case "transfer":
			// Sem destino = "outra conta sua, não identificada" (Pix entre bancos diferentes: o outro lado não é conhecido).
			if (!hasAccount) return "A transferência precisa de uma conta.";
			if (hasCounterpart && t.accountId === t.counterpartAccountId)
				return "Origem e destino da transferência devem ser contas diferentes.";
			if (hasCard) return "Transferência não usa cartão.";
			break;
		case "investment":
			// Aplicação: o dinheiro sai de uma CONTA para investimento. Não é gasto e não passa pelo cartão.
			if (hasCard) return INVESTMENT_ON_CARD_MESSAGE;
			if (!hasAccount) return "A aplicação precisa de uma conta.";
			if (hasCounterpart) return "A conta de destino só vale para transferência.";
			break;
		case "card_payment":
			if (!hasAccount || !hasCard) return "O pagamento de fatura precisa de conta e de cartão.";
			if (hasCounterpart) return "A conta de destino só vale para transferência.";
			break;
	}

	const isCardRow = hasCard && t.kind !== "card_payment";
	if (isCardRow && !has(t.invoiceMonth)) return "Compra no cartão precisa do mês da fatura.";
	if (!isCardRow && has(t.invoiceMonth)) return "Só compra ou estorno no cartão tem mês de fatura.";

	if (t.kind === "refund" && !has(t.refundOfId)) return "O estorno precisa apontar para a despesa original.";
	if (t.kind !== "refund" && has(t.refundOfId)) return "Só estorno aponta para uma despesa original.";

	const parts = [t.installmentGroupId, t.installmentNumber, t.installmentCount].filter(has).length;
	if (parts !== 0 && parts !== 3) return "Parcelamento precisa de grupo, número e total da parcela.";
	if (parts === 3) {
		const n = t.installmentNumber as number;
		const count = t.installmentCount as number;
		if (!Number.isInteger(count) || count < 1 || count > MAX_INSTALLMENT_COUNT) {
			return `O total de parcelas deve ir de 1 a ${MAX_INSTALLMENT_COUNT}.`;
		}
		if (!Number.isInteger(n) || n < 1 || n > count) return "O número da parcela deve ir de 1 até o total.";
	}
	return null;
}
