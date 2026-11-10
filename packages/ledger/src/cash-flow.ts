import { clampDayInMonth, type MonthKey } from "@orbita/core";
import type { Stores, TransactionRecord } from "@orbita/db";
import type { CashFlowResponse } from "@orbita/shared";

/**
 * Fluxo de caixa do mês: o dinheiro que entrou e saiu das CONTAS (não do cartão), pela data do lançamento.
 * Diferente do Gasto: aqui o pagamento de fatura (`card_payment`) é uma saída (o dinheiro saiu da conta), a compra no
 * cartão não é (ainda não saiu), e aplicação/resgate movem caixa. A transferência entre contas próprias fica de fora
 * dos dois lados (só somada em `ignoredTransferCents`). Pendente conta: o dinheiro já saiu ou entrou.
 */
export async function cashFlow(stores: Stores, month: MonthKey): Promise<CashFlowResponse> {
	// Conta arquivada porque a conexão saiu é histórico real: os lançamentos dela seguem contando no caixa do mês.
	// Só o SALDO dela sai (balances.ts).
	const accounts = [...(await stores.accounts.list()), ...(await stores.accounts.listRemovedByConnection())];
	const range = { from: `${month}-01`, to: clampDayInMonth(month, 31) };
	const rows = new Map<string, TransactionRecord>();
	for (const account of accounts) {
		for (const t of await stores.transactions.listByTarget({ accountId: account.id }, range)) {
			// Uma transferência aparece uma vez só, mesmo que as duas pontas sejam contas ativas.
			rows.set(t.id, t);
		}
	}
	const inn = { incomeCents: 0, refundCents: 0, redemptionCents: 0 };
	const out = { expenseCents: 0, cardPaymentCents: 0, investedCents: 0 };
	let ignoredTransferCents = 0;
	for (const t of rows.values()) {
		// O pagamento de fatura tem conta e cartão (a conta é de onde saiu); qualquer outro lançamento de cartão não é caixa.
		if (t.accountId === null || (t.cardId !== null && t.kind !== "card_payment")) continue;
		switch (t.kind) {
			case "income":
				inn.incomeCents += t.amountCents;
				break;
			case "refund":
				inn.refundCents += t.amountCents;
				break;
			case "redemption":
				inn.redemptionCents += t.amountCents;
				break;
			case "expense":
				out.expenseCents += t.amountCents;
				break;
			case "card_payment":
				out.cardPaymentCents += t.amountCents;
				break;
			case "investment":
				out.investedCents += t.amountCents;
				break;
			case "transfer":
				ignoredTransferCents += t.amountCents;
				break;
		}
	}
	const inCents = inn.incomeCents + inn.refundCents + inn.redemptionCents;
	const outCents = out.expenseCents + out.cardPaymentCents + out.investedCents;
	return { month, inCents, outCents, netCents: inCents - outCents, in: inn, out, ignoredTransferCents };
}
