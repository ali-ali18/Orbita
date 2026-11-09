import { MAX_CENTS } from "@orbita/shared";
import type { BillInput, BillPaymentRecord } from "./bill-store.ts";
import { invalid } from "./errors.ts";
import { cleanLocalDate, normalizeIdentity } from "./rules.ts";

const signed = (value: unknown, label: string): number => {
	if (typeof value !== "number" || !Number.isInteger(value) || Math.abs(value) > MAX_CENTS) {
		throw invalid(`${label} deve ser um inteiro de centavos.`);
	}
	return value;
};

export const comparePayments = (a: BillPaymentRecord, b: BillPaymentRecord): number =>
	a.date.localeCompare(b.date) ||
	a.amountCents - b.amountCents ||
	(a.externalId === null ? 1 : 0) - (b.externalId === null ? 1 : 0) ||
	(a.externalId ?? "").localeCompare(b.externalId ?? "");

/** Mais recente primeiro; empate pelo identificador, para a ordem ser a mesma nas duas implementações. */
export const byDueDesc = (
	a: { dueDate: string; externalId: string },
	b: { dueDate: string; externalId: string },
) => b.dueDate.localeCompare(a.dueDate) || a.externalId.localeCompare(b.externalId);

/** Valida e normaliza uma fatura (a mesma regra para memória e Postgres). */
export function normalizeBill(input: BillInput) {
	const identity = normalizeIdentity(input);
	if (identity.source === "manual" || identity.externalId === null) {
		throw invalid("A fatura vem sempre de fora: informe a origem e o identificador.");
	}
	const currency = (input.currency ?? "BRL").trim().toUpperCase();
	if (!/^[A-Z]{3}$/.test(currency)) throw invalid("A moeda da fatura é inválida.");
	const minimum = input.minimumPaymentCents ?? null;
	const payments: BillPaymentRecord[] = (input.payments ?? []).map((p) => ({
		externalId: p.externalId === null ? null : p.externalId.trim().slice(0, 200) || null,
		amountCents: signed(p.amountCents, "O valor do pagamento"),
		date: cleanLocalDate(p.date, "A data do pagamento"),
	}));
	if (!(input.syncedAt instanceof Date) || Number.isNaN(input.syncedAt.getTime())) {
		throw invalid("O instante da sincronização é inválido.");
	}
	return {
		cardId: input.cardId,
		source: identity.source,
		externalId: identity.externalId,
		closeDate: input.closeDate == null ? null : cleanLocalDate(input.closeDate, "A data de fechamento"),
		dueDate: cleanLocalDate(input.dueDate, "A data de vencimento"),
		totalAmountCents: signed(input.totalAmountCents, "O total da fatura"),
		minimumPaymentCents: minimum === null ? null : signed(minimum, "O pagamento mínimo"),
		currency,
		payments: payments.sort(comparePayments),
		syncedAt: input.syncedAt,
	};
}
