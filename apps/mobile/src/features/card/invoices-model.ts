import type { Cents, LocalDate, MonthKey } from "@orbita/core";

/*
 * Visão geral das Faturas: situação honesta de cada fatura (decidida no servidor) e as barras dos últimos meses.
 * Só escolhe palavra, cor e qual valor mostrar; os números vêm de `GET /v1/invoices/overview`.
 */

export type InvoiceStateLike = "paid" | "closed" | "overdue" | "open";

/** "13/11" para "2026-11-13". */
export function dueShort(date: LocalDate): string {
	return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

/** Situação honesta da fatura: Paga · Fechada, vence dd/mm · Vencida · Aberta. */
export function invoiceStateLabel(line: { state: InvoiceStateLike; dueDate: LocalDate }): string {
	switch (line.state) {
		case "paid":
			return "Paga";
		case "closed":
			return `Fechada · vence ${dueShort(line.dueDate)}`;
		case "overdue":
			return `Vencida · venceu ${dueShort(line.dueDate)}`;
		case "open":
			return "Aberta";
	}
}

/** `positive` só para fatura paga (o dinheiro já saiu); o resto é neutro e o texto diz tudo. */
export function invoiceStateTone(state: InvoiceStateLike): "positive" | "primary" | "secondary" {
	return state === "paid" ? "positive" : state === "open" ? "secondary" : "primary";
}

/** De onde vem o total da fatura, em poucas palavras. */
export function invoiceSourceLabel(source: "bank" | "ledger"): string {
	return source === "bank" ? "Total do banco" : "Total estimado pelo Órbita";
}

export interface HistoryBar {
	month: MonthKey;
	cents: Cents;
	/** O mês ainda recebe compras (o valor pode crescer): é o destacado. */
	open: boolean;
}

/** Barras dos últimos meses: de todos os cartões ou só do escolhido. */
export function historyBars(
	history: readonly {
		month: MonthKey;
		totalCents: Cents;
		open: boolean;
		byCard: readonly { cardId: string; totalCents: Cents }[];
	}[],
	cardId: string | null,
): HistoryBar[] {
	return history.map((h) => ({
		month: h.month,
		open: h.open,
		cents: cardId === null ? h.totalCents : (h.byCard.find((c) => c.cardId === cardId)?.totalCents ?? 0),
	}));
}

/** O mês que a barra destaca de início: o último ainda aberto; sem aberto, o último da série. */
export function defaultHistoryMonth(bars: readonly HistoryBar[]): MonthKey | null {
	return (bars.findLast((b) => b.open) ?? bars.at(-1))?.month ?? null;
}
