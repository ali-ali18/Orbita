import { addDays, addMonths } from "./dates.ts";
import { type CardConfig, type Invoice, invoiceByMonth, invoiceFor, invoiceStatus } from "./invoice.ts";
import type { Cents, LocalDate, MonthKey } from "./types.ts";

/** "open" = ainda recebe compras (não há o que pagar); as demais valem para fatura fechada. */
export type PaymentStatus = "paid" | "partial" | "unpaid" | "open";

/** O que a atribuição olha de cada pagamento de fatura (`card_payment`). */
export interface CardPaymentLine {
	amountCents: Cents;
	date: LocalDate;
}

/*
 * Regra de atribuição: um pagamento vale para a ÚLTIMA fatura já fechada na data dele, isto é, a fatura
 * anterior à que está aberta naquele dia (`invoiceFor(data)`). A fatura k recebe os pagamentos feitos entre o
 * dia seguinte ao fim das compras dela e o fim das compras da fatura seguinte. Cobre o pagamento antes do
 * vencimento, no vencimento e o atrasado (inclusive semanas depois do vencimento), porque entre o vencimento e o
 * próximo fechamento só existe uma fatura "para pagar". Pagamento de cartão que cai na fatura ainda aberta
 * (pagou antes de fechar) vai para a anterior: o banco abate do saldo mais antigo. Sem janela de tolerância
 * em dias: a janela já é o ciclo inteiro, então não há buraco entre uma fatura e outra.
 */

/** Mês da fatura (mês do vencimento) a que um pagamento feito em `date` pertence. */
export function invoiceMonthOfPayment(date: LocalDate, card: CardConfig): MonthKey {
	return addMonths(invoiceFor(date, card).month, -1);
}

/** Datas (inclusive) dos pagamentos que pertencem à fatura que vence em `month`. */
export function paymentWindow(month: MonthKey, card: CardConfig): { from: LocalDate; to: LocalDate } {
	const invoice = invoiceByMonth(month, card);
	const next = invoiceByMonth(addMonths(month, 1), card);
	return { from: addDays(invoice.lastPurchaseDate, 1), to: next.lastPurchaseDate };
}

/** Soma dos pagamentos que pertencem à fatura de `month` (ignora os de outras faturas). */
export function paidForInvoice(
	payments: readonly CardPaymentLine[],
	month: MonthKey,
	card: CardConfig,
): Cents {
	let paid = 0;
	for (const p of payments) {
		if (!Number.isSafeInteger(p.amountCents) || p.amountCents <= 0) {
			throw new RangeError("o valor do pagamento deve ser um inteiro positivo");
		}
		if (invoiceMonthOfPayment(p.date, card) === month) paid += p.amountCents;
	}
	return paid;
}

/**
 * Situação do pagamento. Fatura que ainda recebe compras é "open". Fechada: "paid" quando o pago cobre o total
 * (fatura zerada ou negativa não tem o que pagar), "partial" quando pagou parte, "unpaid" quando nada.
 */
export function paymentStatus(
	invoice: Invoice,
	totalCents: Cents,
	paidCents: Cents,
	today: LocalDate,
): PaymentStatus {
	if (invoiceStatus(invoice, today) === "open") return "open";
	if (totalCents <= 0 || paidCents >= totalCents) return "paid";
	return paidCents > 0 ? "partial" : "unpaid";
}
