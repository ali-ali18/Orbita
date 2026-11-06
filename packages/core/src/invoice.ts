import { addDays, addMonths, clampDayInMonth, monthOf, parseLocalDate } from "./dates.ts";
import type { LocalDate, MonthKey } from "./types.ts";

/**
 * O que acontece com a compra feita NO dia do fechamento:
 * - "closing-day-next" (padrão): vai para a próxima fatura (a maioria dos bancos);
 * - "closing-day-included": ainda entra na fatura que fecha (alguns bancos, como o Itaú).
 */
export type ClosingRule = "closing-day-next" | "closing-day-included";

export interface CardConfig {
	/** Dia do fechamento, 1..31 (mês curto usa o último dia). */
	closingDay: number;
	/** Dia do vencimento, 1..31 (mês curto usa o último dia). */
	dueDay: number;
	closingRule?: ClosingRule;
}

export interface Invoice {
	/** A fatura é identificada pelo mês do vencimento, como aparece no app do banco. */
	month: MonthKey;
	closingDate: LocalDate;
	/** Último dia em que uma compra ainda cai nesta fatura (depende da `closingRule`). */
	lastPurchaseDate: LocalDate;
	dueDate: LocalDate;
}

export type InvoiceStatus = "open" | "closed" | "overdue";

/*
 * Regra (bancos brasileiros): a fatura FECHA no dia `closingDay` de cada mês. Por padrão,
 * compra ANTES da data de fechamento entra na fatura que fecha naquele mês; compra NO dia
 * do fechamento ou depois vai para a seguinte. Por isso o "melhor dia de compra" é o
 * próprio dia de fechamento (`nextBestPurchaseDate`): a compra ganha o prazo máximo até o vencimento. Com
 * "closing-day-included" a compra do dia do fechamento ainda entra na fatura que fecha, e
 * o melhor dia passa a ser o seguinte.
 *
 * O vencimento fica no mesmo mês do fechamento se `dueDay > closingDay`, senão no mês
 * seguinte. Essa decisão usa os dias configurados (sem aplicar o limite do mês curto),
 * assim cada mês de vencimento corresponde a exatamente uma fatura. Se decidíssemos pela
 * data já ajustada, fechamento 30 e vencimento 31 gerariam duas faturas vencendo no mesmo
 * dia de março depois de fevereiro. Efeito colateral: em fevereiro o vencimento pode cair
 * no mesmo dia do fechamento (ex.: fecha 30, vence 31 → ambos 28/02).
 *
 * Com "closing-day-included" e fechamento/vencimento nos dias 29 a 31, em mês curto o
 * fechamento, a última compra e o vencimento podem cair no mesmo dia (ex.: fecha 30, vence
 * 31, em 28/02). A fatura vai direto de "open" para "overdue" no dia seguinte, sem passar
 * por "closed". Não é bug: não há dia entre o fim das compras e o vencimento.
 *
 * Vencimento em fim de semana ou feriado NÃO é deslocado para o dia útil (calendário de
 * dias úteis fica fora do escopo por ora). Logo, "overdue" em `invoiceStatus` é por
 * calendário: pode marcar vencida uma fatura que o banco ainda aceitaria pagar no dia útil
 * seguinte.
 */

function assertCard(card: CardConfig): void {
	for (const [label, day] of [
		["dia de fechamento", card.closingDay],
		["dia de vencimento", card.dueDay],
	] as const) {
		if (!Number.isInteger(day) || day < 1 || day > 31) throw new RangeError(`${label} inválido: ${day}`);
	}
	const rule = card.closingRule;
	if (rule !== undefined && rule !== "closing-day-next" && rule !== "closing-day-included") {
		throw new RangeError(`regra de fechamento inválida: ${String(rule)}`);
	}
}

const isIncluded = (card: CardConfig) => card.closingRule === "closing-day-included";
const dueMonthOffset = (card: CardConfig): 0 | 1 => (card.dueDay > card.closingDay ? 0 : 1);

function invoiceClosingIn(closingMonth: MonthKey, card: CardConfig): Invoice {
	const dueMonth = addMonths(closingMonth, dueMonthOffset(card));
	const closingDate = clampDayInMonth(closingMonth, card.closingDay);
	return {
		month: dueMonth,
		closingDate,
		lastPurchaseDate: isIncluded(card) ? closingDate : addDays(closingDate, -1),
		dueDate: clampDayInMonth(dueMonth, card.dueDay),
	};
}

/** Em qual fatura cai uma compra feita em `purchaseDate` (data no fuso do usuário). */
export function invoiceFor(purchaseDate: LocalDate, card: CardConfig): Invoice {
	assertCard(card);
	parseLocalDate(purchaseDate);
	const purchaseMonth = monthOf(purchaseDate);
	const closing = clampDayInMonth(purchaseMonth, card.closingDay);
	const closesThisMonth = isIncluded(card) ? purchaseDate <= closing : purchaseDate < closing;
	return invoiceClosingIn(closesThisMonth ? purchaseMonth : addMonths(purchaseMonth, 1), card);
}

/** A fatura que vence em `month`. */
export function invoiceByMonth(month: MonthKey, card: CardConfig): Invoice {
	assertCard(card);
	return invoiceClosingIn(addMonths(month, -dueMonthOffset(card)), card);
}

/**
 * Próxima data (hoje inclusive) em que comprar rende o prazo máximo: o dia do fechamento,
 * ou o seguinte com "closing-day-included". Não existe "melhor dia" como número do mês:
 * em mês curto o fechamento é ajustado ao último dia e o dia seguinte rola para o mês
 * seguinte, então só a data completa é confiável.
 */
export function nextBestPurchaseDate(today: LocalDate, card: CardConfig): LocalDate {
	assertCard(card);
	const month = monthOf(today);
	// O dia seguinte ao fechamento pode cair no mês seguinte, por isso olha o mês anterior também.
	for (const offset of [-1, 0, 1]) {
		const closing = clampDayInMonth(addMonths(month, offset), card.closingDay);
		const best = isIncluded(card) ? addDays(closing, 1) : closing;
		if (best >= today) return best;
	}
	throw new RangeError("não foi possível achar o melhor dia de compra");
}

/** Pagamento está fora do escopo: aqui só importa onde `today` cai no calendário da fatura. */
export function invoiceStatus(invoice: Invoice, today: LocalDate): InvoiceStatus {
	parseLocalDate(today);
	if (today <= invoice.lastPurchaseDate) return "open";
	return today <= invoice.dueDate ? "closed" : "overdue";
}
