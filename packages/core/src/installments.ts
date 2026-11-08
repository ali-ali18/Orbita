import { addMonths, monthOf } from "./dates.ts";
import { type CardConfig, invoiceFor } from "./invoice.ts";
import { assertCents } from "./money.ts";
import type { Cents, LocalDate, MonthKey } from "./types.ts";

export const MAX_INSTALLMENTS = 72;

export interface Installment {
	number: number;
	count: number;
	amountCents: Cents;
	/** Fatura em que a parcela vence (o que o banco cobra). */
	invoiceMonth: MonthKey;
	/**
	 * Mês do orçamento em que a parcela pesa: mês da compra + (número − 1). Uma compra em
	 * 12x vira 12 lançamentos, um por parcela, cada um com o seu `budgetMonth`; assim 1.200
	 * em 12x só soma 100 ao primeiro mês, e não 1.200.
	 */
	budgetMonth: MonthKey;
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
	// Parcela de zero centavo não existe: o total precisa render ao menos 1 centavo por parcela.
	if (totalCents < count) throw new RangeError("o total é menor que o número de parcelas");
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
	const firstBudget = monthOf(input.purchaseDate);
	return amounts.map((amountCents, i) => ({
		number: i + 1,
		count: input.count,
		amountCents,
		invoiceMonth: addMonths(first, i),
		budgetMonth: addMonths(firstBudget, i),
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

export interface ProjectedInstallment {
	groupId: string;
	description: string;
	number: number;
	count: number;
	amountCents: Cents;
	/** Categoria da última parcela vista (a estimada herda). */
	categoryId: string | null;
}

/**
 * Parcela que o banco ainda não lançou, mas que cai neste mês da fatura. Só depois da última parcela já
 * vista: o que veio antes e não está gravado o Órbita não inventa.
 */
export function projectMissingInstallments(
	groups: readonly {
		groupId: string;
		installments: readonly {
			description: string;
			cardId: string | null;
			categoryId?: string | null;
			installmentNumber: number | null;
			installmentCount: number | null;
			amountCents: Cents;
			invoiceMonth: MonthKey | null;
		}[];
	}[],
	cardId: string,
	month: MonthKey,
): ProjectedInstallment[] {
	const projected: ProjectedInstallment[] = [];
	for (const group of groups) {
		if (group.installments.length === 0 || group.installments[0]?.cardId !== cardId) continue;
		const count = group.installments[0]?.installmentCount ?? group.installments.length;
		if (!Number.isInteger(count) || count <= 1) continue;
		const known = group.installments.filter(
			(item): item is typeof item & { installmentNumber: number; invoiceMonth: MonthKey } =>
				item.installmentNumber !== null && item.invoiceMonth !== null,
		);
		if (known.length === 0 || known.some((item) => item.invoiceMonth === month)) continue;
		const anchor = known.reduce((best, item) =>
			item.installmentNumber > best.installmentNumber ? item : best,
		);
		for (let number = anchor.installmentNumber + 1; number <= count; number += 1) {
			if (addMonths(anchor.invoiceMonth, number - anchor.installmentNumber) !== month) continue;
			projected.push({
				groupId: group.groupId,
				description: anchor.description || group.installments[0]?.description || "Parcela",
				number,
				count,
				amountCents: anchor.amountCents,
				categoryId: anchor.categoryId ?? null,
			});
		}
	}
	return projected;
}
