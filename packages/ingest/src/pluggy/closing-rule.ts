import type { ClosingRule, LocalDate } from "@orbita/core";
import { pluggyDateToLocal } from "./mapping.ts";
import type { PluggyBill, PluggyTransaction } from "./schemas.ts";

/**
 * Regra de fechamento de UM cartão, lida dos dados dele (o banco não a informa): uma compra POSTED, com `billId`,
 * cujo dia (`billPostDate`, ou `purchaseDate` quando não é parcela) é o dia do fechamento de alguma fatura de
 * `/bills`, caiu em qual fatura?
 * - na que fecha naquele dia → `closing-day-included` (a compra do dia do fechamento entra na fatura que fecha);
 * - na seguinte → `closing-day-next`.
 * Sem nenhuma dessas compras não há evidência (`null`) e nada é deduzido; com evidências dos dois lados, vale a
 * maioria, e empate é `null`.
 */
export function inferClosingRule(
	txs: readonly PluggyTransaction[],
	bills: readonly PluggyBill[],
): ClosingRule | null {
	const closings = bills.flatMap((b) => {
		const close = b.billClosingDate ? pluggyDateToLocal(b.billClosingDate) : null;
		return close === null ? [] : [{ id: b.id, close }];
	});
	if (closings.length < 2) return null;
	const byId = new Map(closings.map((b) => [b.id, b]));
	let included = 0;
	let next = 0;
	for (const tx of txs) {
		const meta = tx.creditCardMetadata;
		if (tx.status !== "POSTED" || !meta?.billId) continue;
		const bill = byId.get(meta.billId);
		if (!bill) continue;
		const days: LocalDate[] = [];
		if (meta.billPostDate) {
			const post = pluggyDateToLocal(meta.billPostDate);
			if (post) days.push(post);
		}
		if (meta.purchaseDate && (meta.installmentNumber ?? 1) <= 1) {
			const purchase = pluggyDateToLocal(meta.purchaseDate);
			if (purchase) days.push(purchase);
		}
		for (const day of days) {
			if (day === bill.close) included += 1;
			else if (closings.some((b) => b.id !== bill.id && b.close === day && day < bill.close)) next += 1;
		}
	}
	if (included > next) return "closing-day-included";
	if (next > included) return "closing-day-next";
	return null;
}
