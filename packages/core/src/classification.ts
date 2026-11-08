import { monthOf, parseMonthKey } from "./dates.ts";
import { assertCents } from "./money.ts";
import type { Cents, LocalDate, MonthKey, TransactionKind } from "./types.ts";

export interface Transaction {
	id: string;
	kind: TransactionKind;
	/** Sempre positivo; o sentido vem de `kind`. */
	amountCents: Cents;
	date: LocalDate;
	/**
	 * Mês do orçamento, quando difere do mês da data (parcelas: ver `installmentSchedule`).
	 * Sem ele, vale o mês de `date`.
	 */
	budgetMonth?: MonthKey;
	/**
	 * Fatura (mês do vencimento) de uma compra ou estorno NO CARTÃO. Presente = é do cartão e pesa no gasto do mês em
	 * que a fatura vence, não no da data da compra.
	 */
	invoiceMonth?: MonthKey;
	/** Parcela que o banco ainda não lançou (estimada pelo grupo). Conta no mês, mas o resumo a separa em `projectedCents`. */
	projected?: boolean;
	categoryId?: string;
	/** Id da despesa original, quando `kind` é "refund". */
	refundOf?: string;
}

export const UNCATEGORIZED = "outros";

/**
 * Em que mês o lançamento pesa no GASTO (a definição única do "Gasto do mês"):
 * - compra ou estorno no cartão: o mês da fatura (`invoiceMonth`, o do vencimento), que é quando o dinheiro sai;
 *   cada parcela pesa na sua própria fatura;
 * - o resto (débito, Pix, boleto, receita, aplicação): `budgetMonth`, senão o mês da data.
 */
export function spendingMonthOf(tx: Pick<Transaction, "invoiceMonth" | "budgetMonth" | "date">): MonthKey {
	if (tx.invoiceMonth !== undefined) parseMonthKey(tx.invoiceMonth);
	if (tx.budgetMonth !== undefined) parseMonthKey(tx.budgetMonth);
	return tx.invoiceMonth ?? tx.budgetMonth ?? monthOf(tx.date);
}

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

/** Quanto o lançamento soma ao "Investido" (aplicação). Não é gasto: ver `spendingDelta`. */
export function investedDelta(tx: Transaction): Cents {
	assertPositive(tx);
	return tx.kind === "investment" ? tx.amountCents : 0;
}

export function incomeDelta(tx: Transaction): Cents {
	assertPositive(tx);
	return tx.kind === "income" ? tx.amountCents : 0;
}

export interface MonthSummary {
	/** Soma de `byCategory`; nunca negativo. */
	spentCents: Cents;
	incomeCents: Cents;
	/** Aplicações do mês (dinheiro enviado a investimentos). Fora de `spentCents` e de `byCategory`. */
	investedCents: Cents;
	/** Parte de `spentCents` que é estimativa (parcela ainda não lançada pelo banco). */
	projectedCents: Cents;
	/** Estorno que passou do gasto da categoria no mês e por isso não abateu nada. */
	refundCreditCents: Cents;
	byCategory: Record<string, Cents>;
}

/**
 * Resumo do mês de GASTO (`spendingMonthOf`): conta por data/orçamento, cartão pela fatura que vence no mês. A
 * aplicação em investimento vai para `investedCents`, nunca para o gasto. O estorno abate a
 * categoria da compra original (achada na mesma lista, mesmo de outro mês), senão a do
 * próprio estorno, senão "outros", até no máximo zero. O que passar disso vai para
 * `refundCreditCents`: dinheiro que voltou sem ter gasto a abater neste mês. Assim o
 * total sempre fecha com a soma das categorias e nunca fica negativo.
 * O estorno fica no mês em que acontece (quando o dinheiro volta ou aparece na fatura),
 * não no mês da compra: os meses já fechados não mudam retroativamente.
 */
export function summarizeMonth(transactions: readonly Transaction[], month: MonthKey): MonthSummary {
	const byId = new Map<string, Transaction>();
	for (const tx of transactions) byId.set(tx.id, tx);

	let incomeCents = 0;
	let investedCents = 0;
	let projectedCents = 0;
	let refundCreditCents = 0;
	const byCategory: Record<string, Cents> = {};
	const refunds: Transaction[] = [];

	for (const tx of transactions) {
		// `spendingMonthOf` valida antes de filtrar: mês torto não pode sumir com o lançamento em silêncio.
		if (spendingMonthOf(tx) !== month) continue;
		const spending = spendingDelta(tx);
		incomeCents += incomeDelta(tx);
		investedCents += investedDelta(tx);
		if (tx.kind === "refund") refunds.push(tx);
		else if (spending > 0) {
			const category = tx.categoryId ?? UNCATEGORIZED;
			byCategory[category] = (byCategory[category] ?? 0) + spending;
			if (tx.projected) projectedCents += spending;
		}
	}
	// Estornos depois de todas as despesas, para a ordem da lista não mudar o resultado.
	for (const tx of refunds) {
		const original = tx.refundOf === undefined ? undefined : byId.get(tx.refundOf);
		const category = original?.categoryId ?? tx.categoryId ?? UNCATEGORIZED;
		const current = byCategory[category];
		const applied = Math.min(tx.amountCents, current ?? 0);
		if (current !== undefined) byCategory[category] = current - applied;
		refundCreditCents += tx.amountCents - applied;
	}
	let spentCents = 0;
	for (const value of Object.values(byCategory)) spentCents += value;
	if (
		![spentCents, incomeCents, investedCents, projectedCents, refundCreditCents].every(Number.isSafeInteger)
	) {
		throw new RangeError("soma do mês excede o inteiro seguro");
	}
	return {
		spentCents,
		incomeCents,
		investedCents,
		projectedCents: Math.min(projectedCents, spentCents),
		refundCreditCents,
		byCategory,
	};
}
