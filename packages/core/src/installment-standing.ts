import { addMonths } from "./dates.ts";
import type { Cents, MonthKey } from "./types.ts";

export interface InstallmentRowView {
	number: number;
	count: number;
	amountCents: Cents;
	/** Fatura (mês do vencimento) em que a parcela cai. */
	invoiceMonth: MonthKey;
}

export interface InstallmentStanding {
	count: number;
	/** A parcela vista da fatura vigente (a de maior número cuja fatura já chegou); `null` se nenhuma. */
	currentNumber: number | null;
	/** Valor da parcela vista (a vigente; sem ela, a primeira vista). */
	installmentCents: Cents;
	paidCount: number;
	paidCents: Cents;
	/** Há parcela paga que o Órbita nunca viu: foi estimada pelo valor da primeira vista. */
	paidEstimated: boolean;
	/** Parcelas que faltam; a vigente conta como "falta" (só está paga depois do pagamento da fatura). */
	remainingCount: number;
	remainingCents: Cents;
	/** Há parcela futura que ainda não existe: estimada pelo valor da vigente. */
	remainingEstimated: boolean;
	totalCents: Cents;
	/** O que as parcelas vistas que vencem no mês consultado somam (o que o parcelamento compromete nele). */
	committedMonthCents: Cents;
	/** Fatura da última parcela (a da vigente mais as que faltam depois dela). */
	lastInvoiceMonth: MonthKey | null;
}

/**
 * Andamento de um parcelamento a partir do que o Órbita VIU, não do calendário da compra: se a parcela vista mais
 * recente é a 11/21, o resto sai dela. `refMonth` é a fatura de referência (a aberta de hoje); a vigente é a parcela
 * vista de maior número cuja fatura é `refMonth` ou antes. Paga = as anteriores à vigente (a vigente só está paga
 * depois da fatura). As que vieram antes da primeira parcela vista são estimadas pelo valor da primeira
 * (`paidEstimated`); as futuras que ainda não existem, pelo valor da vigente (`remainingEstimated`).
 */
export function installmentStanding(
	rows: readonly InstallmentRowView[],
	count: number,
	refMonth: MonthKey,
	/** O mês (de vencimento) cujo compromisso se quer somar; por padrão, a própria fatura de referência. */
	committedMonth: MonthKey = refMonth,
): InstallmentStanding {
	const byNumber = new Map<number, InstallmentRowView>();
	for (const r of [...rows].sort((a, b) => a.number - b.number)) {
		if (r.number >= 1 && !byNumber.has(r.number)) byNumber.set(r.number, r);
	}
	const seen = [...byNumber.values()];
	const first = seen[0];
	const total = Math.max(count, seen.at(-1)?.number ?? 0);
	if (!first) {
		return {
			count: total,
			currentNumber: null,
			installmentCents: 0,
			paidCount: 0,
			paidCents: 0,
			paidEstimated: false,
			remainingCount: total,
			remainingCents: 0,
			remainingEstimated: total > 0,
			totalCents: 0,
			committedMonthCents: 0,
			lastInvoiceMonth: null,
		};
	}
	const current = seen.filter((r) => r.invoiceMonth <= refMonth).at(-1) ?? null;
	const unit = current ?? first;
	const paidCount = current ? current.number - 1 : first.number - 1;
	let paidCents = 0;
	let paidEstimated = false;
	for (let k = 1; k <= paidCount; k++) {
		const row = byNumber.get(k);
		if (row) paidCents += row.amountCents;
		else {
			paidCents += first.amountCents;
			paidEstimated = true;
		}
	}
	let remainingCents = 0;
	let remainingEstimated = false;
	for (let k = paidCount + 1; k <= total; k++) {
		const row = byNumber.get(k);
		if (row) remainingCents += row.amountCents;
		else {
			remainingCents += unit.amountCents;
			remainingEstimated = true;
		}
	}
	return {
		count: total,
		currentNumber: current?.number ?? null,
		installmentCents: unit.amountCents,
		paidCount,
		paidCents,
		paidEstimated,
		remainingCount: total - paidCount,
		remainingCents,
		remainingEstimated,
		totalCents: paidCents + remainingCents,
		committedMonthCents: seen
			.filter((r) => r.invoiceMonth === committedMonth)
			.reduce((sum, r) => sum + r.amountCents, 0),
		lastInvoiceMonth: addMonths(unit.invoiceMonth, total - unit.number),
	};
}
