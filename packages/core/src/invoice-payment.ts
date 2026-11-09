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
 * Pago de uma fatura FECHADA contando o pagamento adiantado. A regra de `paidForInvoice` manda o pagamento feito antes
 * do fechamento para a fatura anterior (a mais antiga), mas se essa já estava quitada o que sobra pagou a que estava
 * aberta naquele dia e fechou logo depois (o banco a mostra como paga, com total 0). Então:
 * - entra o excedente da janela da fatura anterior sobre o total dela (`previousTotalCents`, só se vem do banco),
 *   limitado ao total desta;
 * - sai da própria janela o excedente sobre o total (`totalCents`), mas só quando a fatura seguinte já fechou (se
 *   ainda está aberta, o excedente fica aqui, como antes, e não se perde).
 * Fatura ainda aberta não recebe nem repassa nada (não há o que pagar): vale `paidForInvoice`.
 */
export function paidWithAdvance(input: {
	payments: readonly CardPaymentLine[];
	month: MonthKey;
	card: CardConfig;
	today: LocalDate;
	/** Total da fatura de `month` (do banco ou dos lançamentos). */
	totalCents: Cents;
	/**
	 * Total da fatura anterior, só quando vem do banco. `null` (soma dos lançamentos, que pode estar subestimada por
	 * compras anteriores ao Órbita): não repassa excedente nenhum, o pagamento fica com a fatura a que pertence.
	 */
	previousTotalCents: Cents | null;
	/** Total (banco ou lançamentos) da fatura de dois meses antes: o pagamento atrasado dela quita antes de sobrar. */
	olderTotalCents?: Cents | null;
}): Cents {
	const { payments, month, card, today } = input;
	const own = paidForInvoice(payments, month, card);
	if (invoiceStatus(invoiceByMonth(month, card), today) === "open") return own;
	const previous = addMonths(month, -1);
	let overflowIn = 0;
	if (input.previousTotalCents !== null) {
		// Pagamento atrasado da fatura de dois meses antes cai na janela da anterior: cobre primeiro a dívida dela.
		const olderMonth = addMonths(month, -2);
		const olderDeficit =
			input.olderTotalCents == null
				? 0
				: Math.max(0, input.olderTotalCents - paidForInvoice(payments, olderMonth, card));
		overflowIn = Math.min(
			Math.max(0, input.totalCents),
			Math.max(
				0,
				paidForInvoice(payments, previous, card) - olderDeficit - Math.max(0, input.previousTotalCents),
			),
		);
	}
	const next = invoiceByMonth(addMonths(month, 1), card);
	const keptOwn = invoiceStatus(next, today) === "open" ? own : Math.min(own, Math.max(0, input.totalCents));
	return keptOwn + overflowIn;
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
