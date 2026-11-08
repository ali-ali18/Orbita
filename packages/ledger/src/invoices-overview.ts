import { addMonths, type Cents, invoiceFor, type LocalDate, type MonthKey, monthOf } from "@orbita/core";
import { type CardRecord, type Stores, toCardConfig } from "@orbita/db";
import { cardInvoice } from "./summary.ts";

/** Uma fatura como a visão "Faturas" a mostra: tudo vem do engine (`cardInvoice`), nada é recalculado fora dele. */
export interface InvoiceLine {
	month: MonthKey;
	closingDate: LocalDate;
	dueDate: LocalDate;
	status: "open" | "closed" | "overdue";
	paymentStatus: "paid" | "partial" | "unpaid" | "open";
	totalCents: Cents;
	paidCents: Cents;
	/** O que ainda se deve nesta fatura: o total se ainda aberta; o total menos o pago se fechada (nunca negativo). */
	owedCents: Cents;
}

export interface CardInvoicesLine {
	card: CardRecord;
	/** A fatura que vence neste mês (a que se paga agora). */
	due: InvoiceLine;
	/** A fatura aberta de hoje; é a mesma de `due` quando ela já vence neste mês. */
	open: InvoiceLine;
	/** Soma do que se deve neste cartão: a aberta mais as fechadas ainda não pagas. */
	owedCents: Cents;
	/** O vencimento mais próximo ainda por pagar (fechada com saldo; senão o da aberta, se tem compra). */
	nextDueDate: LocalDate | null;
}

export interface InvoicesOverview {
	cards: CardInvoicesLine[];
	/** O total que ainda se deve em todos os cartões. */
	owedCents: Cents;
	nextDueDate: LocalDate | null;
}

async function lineOf(
	stores: Stores,
	cardId: string,
	month: MonthKey,
	today: LocalDate,
): Promise<InvoiceLine> {
	const { invoice, composition } = await cardInvoice(stores, cardId, month, today);
	const totalCents = composition.totalCents;
	return {
		month,
		closingDate: invoice.closingDate,
		dueDate: invoice.dueDate,
		status: invoice.status,
		paymentStatus: invoice.paymentStatus,
		totalCents,
		paidCents: invoice.paidCents,
		owedCents:
			invoice.status === "open" ? Math.max(0, totalCents) : Math.max(0, totalCents - invoice.paidCents),
	};
}

/**
 * "Faturas" do Início: para cada cartão ativo, a fatura que vence neste mês (com o pago e o que falta), a aberta e o
 * quanto ainda se deve (a aberta mais as fechadas sem pagar, já descontados os pagamentos). Olha só o mês anterior,
 * o atual e a aberta: fatura mais velha sem pagamento registrado é histórico anterior ao Órbita, não dívida.
 */
export async function invoicesOverview(stores: Stores, today: LocalDate): Promise<InvoicesOverview> {
	const cards = (await stores.cards.list()).filter((c) => c.archivedAt === null);
	const thisMonth = monthOf(today);
	const lines: CardInvoicesLine[] = [];
	for (const card of cards) {
		const openMonth = invoiceFor(today, toCardConfig(card)).month;
		const months = [...new Set([addMonths(thisMonth, -1), thisMonth, openMonth])].sort();
		const byMonth = new Map<MonthKey, InvoiceLine>();
		for (const m of months) byMonth.set(m, await lineOf(stores, card.id, m, today));
		const all = [...byMonth.values()];
		const due = byMonth.get(thisMonth) as InvoiceLine;
		const open = byMonth.get(openMonth) as InvoiceLine;
		const pending = all.filter((l) => l.owedCents > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
		lines.push({
			card,
			due,
			open,
			owedCents: all.reduce((sum, l) => sum + l.owedCents, 0),
			nextDueDate: pending[0]?.dueDate ?? null,
		});
	}
	const dates = lines.flatMap((l) => (l.nextDueDate ? [l.nextDueDate] : [])).sort();
	return {
		cards: lines,
		owedCents: lines.reduce((sum, l) => sum + l.owedCents, 0),
		nextDueDate: dates[0] ?? null,
	};
}
