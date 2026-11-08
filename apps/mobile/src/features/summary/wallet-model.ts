import type { Cents, LocalDate } from "@orbita/core";
import { type IssuerBand, issuerBand } from "@orbita/tokens";
import { bankLogoKey } from "../../lib/bank-logos.ts";
import { monthName } from "../../lib/format.ts";
import { paidSuffix } from "./summary-model.ts";
import { initialOf } from "./transaction-model.ts";

/*
 * Funções puras da carteira de cartões do Início ("Faturas"). Os números (o que se deve, o pago, o que falta) vêm do
 * servidor (`GET /v1/invoices/overview`, engine); aqui só se ordena, se escolhe a cor e se monta o texto.
 */

export interface WalletInvoice {
	closingDate: LocalDate;
	dueDate: LocalDate;
	status: "open" | "closed" | "overdue";
	paymentStatus: "paid" | "partial" | "unpaid" | "open";
	totalCents: Cents;
	paidCents: Cents;
}

export interface WalletCard {
	card: { id: string; name: string; last4: string | null; bankCode?: string | null };
	due: WalletInvoice;
	open: WalletInvoice;
	nextDueDate: LocalDate | null;
}

/** Ordem das faixas: a que vence primeiro no topo; sem vencimento por último; empate pelo nome. */
export function orderBands<T extends Pick<WalletCard, "nextDueDate"> & { card: { name: string } }>(
	cards: readonly T[],
): T[] {
	return [...cards].sort((a, b) => {
		if (a.nextDueDate !== b.nextDueDate) {
			if (a.nextDueDate === null) return 1;
			if (b.nextDueDate === null) return -1;
			return a.nextDueDate.localeCompare(b.nextDueDate);
		}
		return a.card.name.localeCompare(b.card.name, "pt-BR");
	});
}

export interface BandLook extends IssuerBand {
	initial: string;
	logo: ReturnType<typeof bankLogoKey>;
}

/** Cor, texto e logo da faixa: pelo ISPB ou pelo nome do banco; sem banco conhecido, cinza neutro. */
export function bandLook(card: { name: string; bankCode?: string | null | undefined }): BandLook {
	const logo = bankLogoKey(card);
	return { ...issuerBand(logo), initial: initialOf(card.name), logo };
}

/** "13 de novembro". */
export function longDate(date: LocalDate): string {
	return `${Number(date.slice(8, 10))} de ${monthName(date.slice(0, 7)).toLocaleLowerCase("pt-BR")}`;
}

/** "13/11". */
export function shortDate(date: LocalDate): string {
	return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

export const nextDueText = (next: LocalDate | null) =>
	next === null ? "Nenhuma fatura a vencer" : `Próximo vencimento: ${longDate(next)}`;

/** "Vence 12/11 R$ 691,94 · paga" ou "· falta R$ 100,00"; fatura ainda aberta não diz nada de pagamento. */
export function dueLine(invoice: WalletInvoice, format: (cents: Cents) => string): string {
	const suffix = paidSuffix(invoice, format);
	return `Vence ${shortDate(invoice.dueDate)} ${format(invoice.totalCents)}${suffix ? ` · ${suffix}` : ""}`;
}

/** "Fatura atual R$ 51,50 · fecha em 27 dias" (ou "fecha hoje"). */
export function openLine(
	invoice: WalletInvoice,
	today: LocalDate,
	format: (cents: Cents) => string,
	daysUntil: (from: LocalDate, to: LocalDate) => number,
): string {
	const days = daysUntil(today, invoice.closingDate);
	const closes = days <= 0 ? "fecha hoje" : days === 1 ? "fecha em 1 dia" : `fecha em ${days} dias`;
	return `Fatura atual ${format(invoice.totalCents)} · ${closes}`;
}

/** Cada faixa mostra o logo à esquerda e o final à direita. */
export const bandRight = (card: { last4: string | null }) => (card.last4 ? `•••• ${card.last4}` : "");
