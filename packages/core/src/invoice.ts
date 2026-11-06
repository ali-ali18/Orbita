import { addMonths, clampDayInMonth, monthOf, parseLocalDate } from "./dates.ts";
import type { LocalDate, MonthKey } from "./types.ts";

export interface CardConfig {
	/** Dia do fechamento, 1..31 (mês curto usa o último dia). */
	closingDay: number;
	/** Dia do vencimento, 1..31 (mês curto usa o último dia). */
	dueDay: number;
}

export interface Invoice {
	/** A fatura é identificada pelo mês do vencimento, como aparece no app do banco. */
	month: MonthKey;
	closingDate: LocalDate;
	dueDate: LocalDate;
}

export type InvoiceStatus = "open" | "closed" | "overdue";

/*
 * Regra (bancos brasileiros): a fatura FECHA no dia `closingDay` de cada mês. Compra
 * ANTES da data de fechamento entra na fatura que fecha naquele mês; compra NO dia do
 * fechamento ou depois vai para a seguinte. Por isso o "melhor dia de compra" é o próprio
 * dia de fechamento: a compra ganha o prazo máximo até o vencimento.
 *
 * O vencimento fica no mesmo mês do fechamento se `dueDay > closingDay`, senão no mês
 * seguinte. Essa decisão usa os dias configurados (sem aplicar o limite do mês curto),
 * assim cada mês de vencimento corresponde a exatamente uma fatura. Se decidíssemos pela
 * data já ajustada, fechamento 30 e vencimento 31 gerariam duas faturas vencendo no mesmo
 * dia de março depois de fevereiro. Efeito colateral: em fevereiro o vencimento pode cair
 * no mesmo dia do fechamento (ex.: fecha 30, vence 31 → ambos 28/02).
 */

function assertCard(card: CardConfig): void {
	for (const [label, day] of [
		["dia de fechamento", card.closingDay],
		["dia de vencimento", card.dueDay],
	] as const) {
		if (!Number.isInteger(day) || day < 1 || day > 31) throw new RangeError(`${label} inválido: ${day}`);
	}
}

const dueMonthOffset = (card: CardConfig): 0 | 1 => (card.dueDay > card.closingDay ? 0 : 1);

function invoiceClosingIn(closingMonth: MonthKey, card: CardConfig): Invoice {
	const dueMonth = addMonths(closingMonth, dueMonthOffset(card));
	return {
		month: dueMonth,
		closingDate: clampDayInMonth(closingMonth, card.closingDay),
		dueDate: clampDayInMonth(dueMonth, card.dueDay),
	};
}

/** Em qual fatura cai uma compra feita em `purchaseDate` (data no fuso do usuário). */
export function invoiceFor(purchaseDate: LocalDate, card: CardConfig): Invoice {
	assertCard(card);
	parseLocalDate(purchaseDate);
	const purchaseMonth = monthOf(purchaseDate);
	const closesThisMonth = purchaseDate < clampDayInMonth(purchaseMonth, card.closingDay);
	return invoiceClosingIn(closesThisMonth ? purchaseMonth : addMonths(purchaseMonth, 1), card);
}

/** A fatura que vence em `month`. */
export function invoiceByMonth(month: MonthKey, card: CardConfig): Invoice {
	assertCard(card);
	return invoiceClosingIn(addMonths(month, -dueMonthOffset(card)), card);
}

export function bestPurchaseDay(card: CardConfig): number {
	assertCard(card);
	return card.closingDay;
}

/** Próxima data (hoje inclusive) em que comprar rende o prazo máximo: o dia do fechamento. */
export function nextBestPurchaseDate(today: LocalDate, card: CardConfig): LocalDate {
	assertCard(card);
	const month = monthOf(today);
	const thisMonth = clampDayInMonth(month, card.closingDay);
	return today <= thisMonth ? thisMonth : clampDayInMonth(addMonths(month, 1), card.closingDay);
}

/** Pagamento está fora do escopo: aqui só importa onde `today` cai no calendário da fatura. */
export function invoiceStatus(invoice: Invoice, today: LocalDate): InvoiceStatus {
	parseLocalDate(today);
	if (today < invoice.closingDate) return "open";
	return today <= invoice.dueDate ? "closed" : "overdue";
}
