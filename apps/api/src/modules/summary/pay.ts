import { type LocalDate, type MonthKey, paymentWindow } from "@orbita/core";
import { DataError, type Stores, type TransactionRecord, toCardConfig } from "@orbita/db";
import { cardInvoice } from "@orbita/ledger";
import { orNotFound } from "../../http/errors.ts";

/**
 * "Marcar como paga": lança o pagamento (`card_payment`) do que falta da fatura, tirando da conta escolhida.
 * O valor (total menos o que já foi pago) e a situação vêm do engine; o cliente só escolhe a conta. A data é
 * hoje, mas nunca depois da janela de pagamentos da fatura (uma fatura antiga não pode ganhar um pagamento que
 * o engine atribuiria à fatura seguinte).
 */
export async function payInvoice(
	stores: Stores,
	input: { cardId: string; month: MonthKey; accountId: string; today: LocalDate },
): Promise<{ transaction: TransactionRecord }> {
	const { cardId, month, accountId, today } = input;
	const { card, invoice } = await cardInvoice(stores, cardId, month, today);
	if (invoice.paymentStatus === "open") {
		throw new DataError("invalid", "A fatura ainda está aberta: só dá para pagar depois que ela fecha.");
	}
	if (invoice.paymentStatus === "history") {
		throw new DataError(
			"invalid",
			"Fatura antiga sem pagamento registrado: não há cobrança para marcar como paga.",
		);
	}
	// O que falta é o do engine (total do banco, quando há, menos o pago): o mesmo que a IA e o app mostram.
	const remaining = invoice.owedCents;
	if (invoice.paymentStatus === "paid" || remaining <= 0) {
		throw new DataError("duplicate", "A fatura já está paga.");
	}
	const account = orNotFound(await stores.accounts.get(accountId), "Conta");
	if (account.archivedAt) throw new DataError("invalid", "A conta escolhida está arquivada.");
	const window = paymentWindow(month, toCardConfig(card));
	// biome-ignore lint/complexity/useMathMinMax: datas AAAA-MM-DD são texto; Math.min daria NaN
	const date = today > window.to ? window.to : today;
	const transaction = await stores.transactions.create({
		kind: "card_payment",
		amountCents: remaining,
		date,
		description: `Fatura ${card.name}`.slice(0, 120),
		accountId,
		cardId,
	});
	return { transaction };
}
