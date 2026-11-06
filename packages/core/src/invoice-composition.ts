import type { Cents, TransactionKind } from "./types.ts";

/** O que a composição olha de cada lançamento da fatura. */
export interface InvoiceLine {
	id: string;
	kind: TransactionKind;
	/** Sempre positivo; o sentido vem de `kind`. */
	amountCents: Cents;
	/** Preenchido nas parcelas. */
	installmentGroupId?: string | null;
}

export interface InvoiceComposition {
	purchasesCents: Cents;
	installmentsCents: Cents;
	recurringCents: Cents;
	/** Estornos, positivos; o total os subtrai. */
	refundsCents: Cents;
	totalCents: Cents;
}

/**
 * De onde vem o total da fatura: compras avulsas, parcelas, recorrências (assinaturas) e
 * estornos (que abatem). Só despesa e estorno entram: pagamento de fatura não é compra
 * (pagar não aumenta a fatura) e receita não existe no cartão. Parcela vale como parcela
 * mesmo que venha de uma recorrência.
 */
export function invoiceComposition(
	lines: readonly InvoiceLine[],
	options: { recurringTransactionIds?: ReadonlySet<string> } = {},
): InvoiceComposition {
	const recurring = options.recurringTransactionIds ?? new Set<string>();
	let purchasesCents = 0;
	let installmentsCents = 0;
	let recurringCents = 0;
	let refundsCents = 0;
	for (const line of lines) {
		if (!Number.isSafeInteger(line.amountCents) || line.amountCents <= 0) {
			throw new RangeError(`lançamento ${line.id}: o valor deve ser um inteiro positivo`);
		}
		if (line.kind === "refund") refundsCents += line.amountCents;
		else if (line.kind !== "expense") continue;
		else if (line.installmentGroupId != null) installmentsCents += line.amountCents;
		else if (recurring.has(line.id)) recurringCents += line.amountCents;
		else purchasesCents += line.amountCents;
	}
	const totalCents = purchasesCents + installmentsCents + recurringCents - refundsCents;
	if (
		![purchasesCents, installmentsCents, recurringCents, refundsCents, totalCents].every(Number.isSafeInteger)
	) {
		throw new RangeError("soma da fatura excede o inteiro seguro");
	}
	return { purchasesCents, installmentsCents, recurringCents, refundsCents, totalCents };
}
