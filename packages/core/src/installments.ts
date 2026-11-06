import { addMonths } from "./dates.ts";
import { type CardConfig, invoiceFor } from "./invoice.ts";
import { assertCents } from "./money.ts";
import type { Cents, LocalDate, MonthKey } from "./types.ts";

export const MAX_INSTALLMENTS = 72;

export interface Installment {
	number: number;
	count: number;
	amountCents: Cents;
	invoiceMonth: MonthKey;
}

/**
 * Divide em parcelas inteiras. O resto dos centavos vai para a PRIMEIRA parcela, como é
 * comum no Brasil (10000 em 3 → 3334, 3333, 3333): a soma fecha exatamente com o total.
 */
export function splitInstallments(totalCents: Cents, count: number): Cents[] {
	assertCents(totalCents, "total");
	if (totalCents <= 0) throw new RangeError("o total a parcelar deve ser maior que zero");
	if (!Number.isInteger(count) || count < 1 || count > MAX_INSTALLMENTS) {
		throw new RangeError(`o número de parcelas deve ser de 1 a ${MAX_INSTALLMENTS}`);
	}
	const base = Math.floor(totalCents / count);
	const remainder = totalCents - base * count;
	return Array.from({ length: count }, (_, i) => (i === 0 ? base + remainder : base));
}

/** A parcela 1 cai na fatura da compra; cada seguinte, um mês depois. */
export function installmentSchedule(input: {
	purchaseDate: LocalDate;
	totalCents: Cents;
	count: number;
	card: CardConfig;
}): Installment[] {
	const amounts = splitInstallments(input.totalCents, input.count);
	const first = invoiceFor(input.purchaseDate, input.card).month;
	return amounts.map((amountCents, i) => ({
		number: i + 1,
		count: input.count,
		amountCents,
		invoiceMonth: addMonths(first, i),
	}));
}

export interface InstallmentProgress {
	paidCents: Cents;
	remainingCents: Cents;
	paidCount: number;
	remainingCount: number;
}

/**
 * Para o "Pago R$ … / Falta R$ …". `fromMonth` é a fatura atual: parcelas de faturas
 * anteriores contam como pagas; a da fatura atual ainda conta como "falta", porque só
 * está paga depois do pagamento (que o engine não acompanha).
 */
export function remainingInstallments(
	schedule: readonly Installment[],
	fromMonth: MonthKey,
): InstallmentProgress {
	const result: InstallmentProgress = { paidCents: 0, remainingCents: 0, paidCount: 0, remainingCount: 0 };
	for (const item of schedule) {
		if (item.invoiceMonth < fromMonth) {
			result.paidCents += item.amountCents;
			result.paidCount += 1;
		} else {
			result.remainingCents += item.amountCents;
			result.remainingCount += 1;
		}
	}
	return result;
}
