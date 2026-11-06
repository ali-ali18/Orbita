import type { Cents, LocalDate } from "@orbita/core";
import { relativeDate } from "../../lib/format.ts";

export interface TransactionLike {
	kind: "expense" | "income" | "transfer" | "card_payment" | "refund";
	amountCents: Cents;
	date: LocalDate;
	accountId: string | null;
	cardId: string | null;
	installmentNumber: number | null;
	installmentCount: number | null;
	status: "pending" | "confirmed";
}

/** Sinal do valor (o design não usa verde/vermelho): saída −, entrada +, movimento entre contas sem sinal. */
export function signedAmount(t: Pick<TransactionLike, "kind" | "amountCents">): Cents {
	if (t.kind === "expense") return -t.amountCents;
	return t.amountCents;
}

export function amountSignMode(kind: TransactionLike["kind"]): "always" | "never" {
	return kind === "transfer" || kind === "card_payment" ? "never" : "always";
}

/** "Hoje · Nubank ••••0695 · 2/3 · Para revisar". */
export function transactionCaption(
	t: TransactionLike,
	today: LocalDate,
	sources: {
		accounts: ReadonlyMap<string, { name: string }>;
		cards: ReadonlyMap<string, { name: string; last4: string | null }>;
	},
): string {
	const parts: string[] = [relativeDate(t.date, today)];
	const card = t.cardId ? sources.cards.get(t.cardId) : undefined;
	const account = t.accountId ? sources.accounts.get(t.accountId) : undefined;
	if (card) parts.push(card.last4 ? `${card.name} ••••${card.last4}` : card.name);
	else if (account) parts.push(account.name);
	if (t.installmentNumber !== null && t.installmentCount !== null) {
		parts.push(`${t.installmentNumber}/${t.installmentCount}`);
	}
	if (t.status === "pending") parts.push("Para revisar");
	return parts.join(" · ");
}

/** Letras do círculo quando não há logo: primeira letra do nome, maiúscula. */
export function initialOf(name: string): string {
	return name.trim().charAt(0).toLocaleUpperCase("pt-BR") || "·";
}
