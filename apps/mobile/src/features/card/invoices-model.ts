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

/** Só a situação, para a pílula (a data de vencimento vai em outra linha). */
export function invoiceStateWord(state: InvoiceStateLike): string {
	return { paid: "Paga", closed: "Fechada", overdue: "Vencida", open: "Aberta" }[state];
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
	/** Situação do mês (a do cartão escolhido ou, em "Todos", a mais urgente entre os cartões). */
	state: InvoiceStateLike;
}

/** Barras dos meses: de todos os cartões ou só do escolhido. Cartão sem fatura no mês fica com 0 e "aberta". */
export function historyBars(
	history: readonly {
		month: MonthKey;
		totalCents: Cents;
		state: InvoiceStateLike;
		byCard: readonly { cardId: string; totalCents: Cents; state: InvoiceStateLike }[];
	}[],
	cardId: string | null,
): HistoryBar[] {
	return history.map((h) => {
		if (cardId === null) return { month: h.month, cents: h.totalCents, state: h.state };
		const own = h.byCard.find((c) => c.cardId === cardId);
		return { month: h.month, cents: own?.totalCents ?? 0, state: own?.state ?? "open" };
	});
}

/**
 * O mês selecionado: o que o dono tocou, se ainda existe nas barras; senão o padrão (`preferred`, a fatura aberta ou a
 * que vence, se tem barra); senão o último mês com barra. Sem barras, `null`.
 */
export function selectedBarMonth(
	bars: readonly HistoryBar[],
	picked: MonthKey | null,
	preferred: MonthKey | null,
): MonthKey | null {
	for (const m of [picked, preferred]) if (m && bars.some((b) => b.month === m)) return m;
	return bars.at(-1)?.month ?? null;
}

/** Em "Todos" o mês padrão é o do próximo vencimento (o mês da fatura é o do vencimento); sem ele, o da aberta. */
export function overviewDefaultMonth(
	nextDueDate: LocalDate | null,
	bars: readonly HistoryBar[],
	today: LocalDate,
): MonthKey | null {
	if (nextDueDate) return nextDueDate.slice(0, 7);
	return bars.find((b) => b.month === today.slice(0, 7))?.month ?? null;
}

/** Rótulo falado da barra: "Fatura de novembro, R$ 1.200,00, paga". */
export function barLabel(monthLabel: string, value: string, state: InvoiceStateLike): string {
	return `Fatura de ${monthLabel}, ${value}, ${invoiceStateWord(state).toLowerCase()}`;
}
