import { addMonths, type Cents, invoiceFor, type LocalDate, type MonthKey, monthOf } from "@orbita/core";
import { type CardRecord, type Stores, toCardConfig } from "@orbita/db";
import { activeInstallments, cardInvoice } from "./summary.ts";

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
	/**
	 * Limite comprometido: o que se deve (`owedCents`) mais as parcelas que caem depois da fatura aberta. Fatura
	 * fechada já paga não entra. O app só exibe; o banco não manda o limite disponível.
	 */
	usedLimitCents: Cents;
}

export interface InvoicesOverview {
	cards: CardInvoicesLine[];
	/** O total que ainda se deve em todos os cartões. */
	owedCents: Cents;
	nextDueDate: LocalDate | null;
}

/** O que ainda se deve numa fatura: o total se aberta; o total menos o pago se fechada (nunca negativo). */
export function invoiceOwedCents(status: InvoiceLine["status"], totalCents: Cents, paidCents: Cents): Cents {
	return status === "open" ? Math.max(0, totalCents) : Math.max(0, totalCents - paidCents);
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
		owedCents: invoiceOwedCents(invoice.status, totalCents, invoice.paidCents),
	};
}

/**
 * "Faturas" do Início: para cada cartão ativo, a fatura a pagar (com o pago e o que falta), a aberta e o quanto
 * ainda se deve (a aberta mais as fechadas sem pagar, já descontados os pagamentos).
 *
 * Meses olhados: a aberta, a anterior a ela (a fechada que está para vencer, mesmo quando vence só no mês seguinte
 * ao fechamento) e o mês anterior e o atual do calendário (vencida há pouco). Fatura mais velha sem pagamento
 * registrado é histórico anterior ao Órbita, não dívida. `due` é a fechada com saldo de vencimento mais próximo;
 * sem nenhuma, a fechada que ainda vai vencer; por fim, a que vence neste mês.
 */
export async function invoicesOverview(stores: Stores, today: LocalDate): Promise<InvoicesOverview> {
	const cards = (await stores.cards.list()).filter((c) => c.archivedAt === null);
	const thisMonth = monthOf(today);
	const installmentGroups = await activeInstallments(stores, thisMonth);
	const lines: CardInvoicesLine[] = [];
	for (const card of cards) {
		const openMonth = invoiceFor(today, toCardConfig(card)).month;
		const months = [
			...new Set([addMonths(thisMonth, -1), thisMonth, addMonths(openMonth, -1), openMonth]),
		].sort();
		const byMonth = new Map<MonthKey, InvoiceLine>();
		for (const m of months) byMonth.set(m, await lineOf(stores, card.id, m, today));
		const all = [...byMonth.values()];
		const open = byMonth.get(openMonth) as InvoiceLine;
		const pending = all.filter((l) => l.owedCents > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
		const closed = all.filter((l) => l.status !== "open").sort((a, b) => a.dueDate.localeCompare(b.dueDate));
		const due =
			pending.find((l) => l.status !== "open") ??
			closed.find((l) => l.dueDate >= today) ??
			(byMonth.get(thisMonth) as InvoiceLine);
		const owedCents = all.reduce((sum, l) => sum + l.owedCents, 0);
		let futureCents = 0;
		for (const g of installmentGroups) {
			if (g.cardId !== card.id || g.remainingCount <= 0) continue;
			for (const t of g.installments) {
				if (t.invoiceMonth !== null && t.invoiceMonth > openMonth) futureCents += t.amountCents;
			}
		}
		lines.push({
			card,
			due,
			open,
			owedCents,
			nextDueDate: pending[0]?.dueDate ?? null,
			usedLimitCents: owedCents + futureCents,
		});
	}
	const dates = lines.flatMap((l) => (l.nextDueDate ? [l.nextDueDate] : [])).sort();
	return {
		cards: lines,
		owedCents: lines.reduce((sum, l) => sum + l.owedCents, 0),
		nextDueDate: dates[0] ?? null,
	};
}
