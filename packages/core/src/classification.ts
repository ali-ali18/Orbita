import { monthOf } from "./dates.ts";
import { assertCents } from "./money.ts";
import type { Cents, LocalDate, MonthKey, TransactionKind } from "./types.ts";

export interface Transaction {
	id: string;
	kind: TransactionKind;
	/** Sempre positivo; o sentido vem de `kind`. */
	amountCents: Cents;
	date: LocalDate;
	categoryId?: string;
	/** Id da despesa original, quando `kind` é "refund". */
	refundOf?: string;
}

export const UNCATEGORIZED = "outros";

function assertPositive(tx: Transaction): void {
	assertCents(tx.amountCents, "amountCents");
	if (tx.amountCents <= 0) throw new RangeError(`lançamento ${tx.id}: o valor deve ser positivo`);
}

/**
 * Quanto o lançamento soma ao gasto. Só despesa conta (+) e estorno desfaz (−).
 * Pagar a fatura do cartão NÃO é gasto: as compras já foram contadas quando foram feitas,
 * contar o pagamento de novo dobraria o gasto. Transferência entre contas suas também
 * não: o dinheiro só mudou de bolso.
 */
export function spendingDelta(tx: Transaction): Cents {
	assertPositive(tx);
	if (tx.kind === "expense") return tx.amountCents;
	if (tx.kind === "refund") return -tx.amountCents;
	return 0;
}

export function incomeDelta(tx: Transaction): Cents {
	assertPositive(tx);
	return tx.kind === "income" ? tx.amountCents : 0;
}

export interface MonthSummary {
	spentCents: Cents;
	incomeCents: Cents;
	byCategory: Record<string, Cents>;
}

/**
 * Resumo de um mês. O estorno abate a categoria da compra original (achada na mesma
 * lista, mesmo que seja de outro mês: estornar em março uma compra de fevereiro reduz o
 * gasto de março). Sem original na lista, usa a categoria do próprio estorno, ou "outros".
 * `spentCents` é o líquido real; categorias nunca ficam abaixo de zero (um estorno maior
 * que o gasto do mês na categoria não vira "crédito" na tela).
 */
export function summarizeMonth(transactions: readonly Transaction[], month: MonthKey): MonthSummary {
	const byId = new Map<string, Transaction>();
	for (const tx of transactions) byId.set(tx.id, tx);

	let spentCents = 0;
	let incomeCents = 0;
	const byCategory: Record<string, Cents> = {};

	for (const tx of transactions) {
		if (monthOf(tx.date) !== month) continue;
		const spending = spendingDelta(tx);
		incomeCents += incomeDelta(tx);
		if (spending === 0) continue;
		spentCents += spending;
		const original = tx.refundOf === undefined ? undefined : byId.get(tx.refundOf);
		const category =
			(tx.kind === "refund" ? (original?.categoryId ?? tx.categoryId) : tx.categoryId) ?? UNCATEGORIZED;
		byCategory[category] = (byCategory[category] ?? 0) + spending;
	}
	for (const key of Object.keys(byCategory)) {
		if ((byCategory[key] ?? 0) < 0) byCategory[key] = 0;
	}
	if (!Number.isSafeInteger(spentCents) || !Number.isSafeInteger(incomeCents)) {
		throw new RangeError("soma do mês excede o inteiro seguro");
	}
	return { spentCents, incomeCents, byCategory };
}
