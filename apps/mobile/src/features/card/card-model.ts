import {
	addMonths,
	type Cents,
	daysBetween,
	type InvoiceStatus,
	invoiceByMonth,
	invoiceFor,
	invoiceStatus,
	type LocalDate,
	type MonthKey,
	nextBestPurchaseDate,
} from "@orbita/core";
import { chart, chartSeries } from "@orbita/tokens";
import { dayMonth, monthName, monthYear, percentOf, pluralDays } from "../../lib/format.ts";
import { bankColor } from "../summary/summary-model.ts";

/*
 * Funções puras das telas do Cartão (Faturas, Parcelas, Limites). Os números (total da fatura, composição,
 * pago/falta) vêm do engine pela API; aqui só se escolhe mês, texto, cor e se agrupa para exibir.
 */

// ------------------------------------------------------------------ abas

export const CARD_TABS = [
	{ id: "faturas", label: "Faturas" },
	{ id: "parcelas", label: "Parcelas" },
	{ id: "limites", label: "Limites" },
] as const;
export type CardTab = (typeof CARD_TABS)[number]["id"];

/** Aba vinda da rota (`?aba=parcelas`); qualquer outra coisa abre Faturas. */
export function parseTab(value: string | string[] | undefined): CardTab {
	const first = Array.isArray(value) ? value[0] : value;
	return CARD_TABS.find((t) => t.id === first)?.id ?? "faturas";
}

// ---------------------------------------------------------------- cartões

export interface CardLike {
	id: string;
	name: string;
	bankCode: string | null;
	last4: string | null;
	closingDay: number;
	dueDay: number;
	closingRule: "closing-day-next" | "closing-day-included";
	limitCents: number | null;
	archivedAt: string | null;
}

export function activeCards<T extends Pick<CardLike, "archivedAt">>(cards: readonly T[]): T[] {
	return cards.filter((c) => c.archivedAt === null);
}

/** "•••• 5512", ou o nome quando o banco não mandou os 4 últimos dígitos. */
export function cardLabel(card: Pick<CardLike, "name" | "last4">): string {
	return card.last4 ? `•••• ${card.last4}` : card.name;
}

/** "Santander Free Visa · final 5512" para leitor de tela. */
export function cardSpokenName(card: Pick<CardLike, "name" | "last4">): string {
	return card.last4 ? `${card.name}, final ${card.last4}` : card.name;
}

/** Cor da marca do cartão, a mesma do logo: pelo ISPB e, sem ele, pelo nome. */
export function cardColor(card: Pick<CardLike, "bankCode" | "name">): string {
	return bankColor(card.bankCode, card.name);
}

// ---------------------------------------------------------------- faturas

/**
 * Fatura que a tela abre. A aberta (a das compras de hoje) é a regra; mas se a anterior já fechou e ainda não
 * venceu, é ela que está para pagar, e é essa que o Figma mostra primeiro.
 */
export function defaultInvoiceMonth(card: CardLike, today: LocalDate): MonthKey {
	const open = invoiceFor(today, card);
	const previous = invoiceByMonth(addMonths(open.month, -1), card);
	return invoiceStatus(previous, today) === "closed" ? previous.month : open.month;
}

/** A fatura das compras de hoje (a "Fatura atual" do Início). */
export function openInvoiceMonth(card: CardLike, today: LocalDate): MonthKey {
	return invoiceFor(today, card).month;
}

/** Meses da fila de chips: `before` antes e `after` depois do mês aberto, em ordem. */
export function monthWindow(anchor: MonthKey, before = 6, after = 3): MonthKey[] {
	const months: MonthKey[] = [];
	for (let i = -before; i <= after; i += 1) months.push(addMonths(anchor, i));
	return months;
}

/** Situação da fatura do mês, pelo calendário (o engine não acompanha pagamento). */
export function statusOfMonth(card: CardLike, month: MonthKey, today: LocalDate): InvoiceStatus {
	return invoiceStatus(invoiceByMonth(month, card), today);
}

/**
 * Rótulo de situação. O engine só sabe o calendário, então "vencida" não quer dizer "não paga":
 * o texto diz o fato ("venceu"), não o que ele não sabe.
 */
/**
 * Rótulo do mês na fila. "Venceu" só quando a fatura passou do vencimento e não foi paga.
 * Paga continua "paga", mesmo que o calendário já tenha passado.
 */
export function monthChipLabel(status: InvoiceStatus, payment?: PaymentStatusLike): string {
	if (payment === "paid" && status !== "open") return "paga";
	if (payment === "history" && status !== "open") return "histórico";
	return statusLabel(status);
}

export function statusLabel(status: InvoiceStatus): string {
	switch (status) {
		case "open":
			return "aberta";
		case "closed":
			return "fechada";
		case "overdue":
			return "venceu";
	}
}

/** `history`: fatura antiga sem pagamento registrado (anterior ao Órbita): sem cobrança, sem atraso. */
export type PaymentStatusLike = "paid" | "partial" | "unpaid" | "open" | "history";

export interface PaymentBadge {
	label: string;
	/** `positive` só para fatura paga; o resto é neutro (cor nunca é a única informação: o texto diz tudo). */
	tone: "positive" | "primary" | "secondary";
}

/**
 * Selo de pagamento da fatura, a partir do que o servidor calculou (`paymentStatus`, `owedCents`):
 * Paga · Paga em parte (falta R$ X) · Em aberto · Vence dia X · Atrasada. "Atrasada" só quando a fatura
 * venceu e não foi paga por inteiro; paga em parte e vencida acrescenta " · atrasada".
 */
export function paymentBadge(
	invoice: { status: InvoiceStatus; dueDate: LocalDate; paymentStatus: PaymentStatusLike; owedCents: Cents },
	formatMoney: (cents: Cents) => string,
): PaymentBadge {
	const overdue = invoice.status === "overdue";
	switch (invoice.paymentStatus) {
		case "paid":
			return { label: "Paga", tone: "positive" };
		case "partial": {
			const left = formatMoney(Math.max(0, invoice.owedCents));
			return { label: `Paga em parte (falta ${left})${overdue ? " · atrasada" : ""}`, tone: "primary" };
		}
		case "unpaid":
			return overdue
				? { label: "Atrasada", tone: "primary" }
				: { label: `Vence dia ${Number(invoice.dueDate.slice(8, 10))}`, tone: "primary" };
		case "open":
			return { label: "Em aberto", tone: "secondary" };
		case "history":
			return { label: "Histórico", tone: "secondary" };
	}
}

/**
 * "Marcar como paga" só aparece com a fatura fechada e com saldo a pagar. O valor é o `owedCents` que o servidor já
 * calculou (total da fatura, o do banco quando há, menos o pago); o app só decide se o botão existe e o mostra.
 */
export function payableCents(invoice: {
	status: InvoiceStatus;
	paymentStatus: PaymentStatusLike;
	owedCents: Cents;
}): Cents {
	if (invoice.status === "open") return 0;
	if (invoice.paymentStatus !== "unpaid" && invoice.paymentStatus !== "partial") return 0;
	return Math.max(0, invoice.owedCents);
}

/** Contas ativas que podem pagar a fatura, na ordem em que vieram. */
export function payerAccounts<T extends { archivedAt: string | null }>(accounts: readonly T[]): T[] {
	return accounts.filter((a) => a.archivedAt === null);
}

/** Consultas que mudam quando um pagamento de fatura entra ou sai (a chave é `[baseUrl, assunto, …]`). */
const PAYMENT_AFFECTED: ReadonlySet<unknown> = new Set([
	"summary",
	"transactions",
	"month-transactions",
	"invoice",
	"invoices-overview",
	"installments",
	"accounts",
]);

export function isAffectedByInvoicePayment(queryKey: readonly unknown[], baseUrl: string): boolean {
	return queryKey[0] === baseUrl && PAYMENT_AFFECTED.has(queryKey[1]);
}

export const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase("pt-BR") + text.slice(1);

/** "Vence 7 de nov · fechou 31 de out" (fechada), "Fecha 30 de nov · vence 7 de dez" (aberta). */
export function invoiceDatesCaption(invoice: {
	status: InvoiceStatus;
	closingDate: LocalDate;
	dueDate: LocalDate;
	paymentStatus?: PaymentStatusLike;
}): string {
	const closing = dayMonth(invoice.closingDate);
	const due = dayMonth(invoice.dueDate);
	// Fatura histórica: só o fato do fechamento (mm/aa), sem vencimento nem cobrança.
	if (invoice.paymentStatus === "history") return `Fechada em ${closingMonthYear(invoice.closingDate)}`;
	switch (invoice.status) {
		case "open":
			return `Fecha ${closing} · vence ${due}`;
		case "closed":
			return `Vence ${due} · fechou ${closing}`;
		case "overdue":
			// Fatura paga não "venceu": o vencimento só passou.
			return invoice.paymentStatus === "paid"
				? `Vencimento ${due} · fechou ${closing}`
				: `Venceu ${due} · fechou ${closing}`;
	}
}

/** "10/26" para "2026-10-31". */
export function closingMonthYear(date: LocalDate): string {
	return `${date.slice(5, 7)}/${date.slice(2, 4)}`;
}

/** Selo da fatura (canto do card): a situação do pagamento quando ela já fechou, senão o calendário. */
export function invoiceStatusTag(invoice: {
	status: InvoiceStatus;
	paymentStatus: PaymentStatusLike;
}): string {
	if (invoice.status !== "open" && invoice.paymentStatus === "paid") return "Paga";
	if (invoice.status !== "open" && invoice.paymentStatus === "history") return "Histórico";
	return capitalize(statusLabel(invoice.status));
}

export interface CompositionLike {
	purchasesCents: Cents;
	installmentsCents: Cents;
	recurringCents: Cents;
	refundsCents: Cents;
}

export interface CompositionRow {
	key: "purchases" | "subscriptions" | "installments" | "refunds";
	label: string;
	cents: Cents;
	color: string;
}

/** As quatro linhas do "O que entrou nela", com a cor de cada uma (ordem e cores fixas do gráfico). */
export function compositionRows(c: CompositionLike): CompositionRow[] {
	return [
		{ key: "purchases", label: "Compras", cents: c.purchasesCents, color: chartSeries[0] },
		{ key: "subscriptions", label: "Assinaturas", cents: c.recurringCents, color: chartSeries[1] },
		{ key: "installments", label: "Parcelas", cents: c.installmentsCents, color: chartSeries[2] },
		{ key: "refunds", label: "Estornos", cents: c.refundsCents, color: chart.other },
	];
}

/** A barra mostra só o que soma na fatura; estorno abate e fica só na lista. */
export function compositionBar(rows: readonly CompositionRow[]) {
	return rows
		.filter((r) => r.key !== "refunds" && r.cents > 0)
		.map((r) => ({ key: r.key, color: r.color, weight: r.cents }));
}

export const INVOICE_FILTERS = [
	{ id: "all", label: "Tudo" },
	{ id: "purchases", label: "Compras" },
	{ id: "installments", label: "Parcelas" },
] as const;
export type InvoiceFilter = (typeof INVOICE_FILTERS)[number]["id"];

export interface InvoiceLine {
	id: string;
	kind: "expense" | "income" | "transfer" | "card_payment" | "refund" | "investment" | "redemption";
	date: LocalDate;
	installmentGroupId: string | null;
	installmentNumber: number | null;
	installmentCount: number | null;
	note?: string | null;
}

/** Mais recente primeiro (a API não promete ordem). "Compras" = o que não é parcela nem estorno. */
export function filterInvoiceLines<T extends InvoiceLine>(lines: readonly T[], filter: InvoiceFilter): T[] {
	const kept = lines.filter((t) => {
		if (filter === "installments") return t.installmentGroupId !== null;
		if (filter === "purchases") return t.installmentGroupId === null && t.kind !== "refund";
		return true;
	});
	return [...kept].sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? 1 : -1));
}

/** "19/10 · Assinaturas", "14/10 · Mercado · 2/3". */
export function invoiceLineCaption(line: InvoiceLine, categoryName: string | undefined): string {
	const parts = [`${line.date.slice(8, 10)}/${line.date.slice(5, 7)}`];
	if (categoryName) parts.push(categoryName);
	if (line.installmentNumber !== null && line.installmentCount !== null) {
		parts.push(`${line.installmentNumber}/${line.installmentCount}`);
	}
	if (line.note?.startsWith("Estimada")) parts.push("estimada");
	return parts.join(" · ");
}

export function emptyInvoiceMessage(filter: InvoiceFilter): string {
	if (filter === "installments") return "Nenhuma parcela nesta fatura.";
	if (filter === "purchases") return "Nenhuma compra nesta fatura.";
	return "Nenhum lançamento nesta fatura.";
}

// --------------------------------------------------------------- parcelas

export interface InstallmentLike {
	invoiceMonth: MonthKey | null;
	amountCents: Cents;
	installmentNumber: number | null;
}

export interface InstallmentGroupLike {
	groupId: string;
	description: string;
	cardId: string | null;
	count: number;
	totalCents: Cents;
	paidCents: Cents;
	remainingCents: Cents;
	paidCount: number;
	remainingCount: number;
	/** A parcela vista da fatura vigente ("11 de 21"); `null` se nenhuma já pesou. */
	currentNumber: number | null;
	/** Valor da parcela vista. */
	installmentCents: Cents;
	/** Parte do "pago" é estimativa (parcelas que o Órbita nunca viu). */
	paidEstimated: boolean;
	remainingEstimated: boolean;
	/** O que as parcelas do mês de referência somam (do servidor). */
	committedMonthCents: Cents;
	/** Fatura (mês do vencimento) da última parcela. */
	lastInvoiceMonth: MonthKey | null;
	installments: readonly InstallmentLike[];
}

/** Parcelamentos que ainda têm parcela a pagar. */
export function activeGroups<T extends Pick<InstallmentGroupLike, "remainingCount">>(
	groups: readonly T[],
): T[] {
	return groups.filter((g) => g.remainingCount > 0);
}

/** Comprometido no mês (parcelas que caem na fatura dele) e o que vem depois dele. */
export function commitment(groups: readonly InstallmentGroupLike[], month: MonthKey) {
	let committedCents = 0;
	let futureCents = 0;
	for (const g of activeGroups(groups)) {
		for (const t of scheduleAmounts(g)) {
			if (t.month === month) committedCents += t.cents;
			else if (t.month > month) futureCents += t.cents;
		}
	}
	return { committedCents, futureCents };
}

/**
 * Totais do topo da aba: o comprometido no mês e o que resta, somando o que o servidor calculou por parcelamento
 * (só os ativos). `estimated` avisa que parte do "resta" é estimativa.
 */
export function installmentTotals(groups: readonly InstallmentGroupLike[]) {
	let committedCents = 0;
	let remainingCents = 0;
	let estimated = false;
	for (const g of activeGroups(groups)) {
		committedCents += g.committedMonthCents;
		remainingCents += g.remainingCents;
		if (g.remainingEstimated) estimated = true;
	}
	return { committedCents, remainingCents, estimated, count: activeGroups(groups).length };
}

export interface MonthColumn {
	month: MonthKey;
	totalCents: Cents;
	/** Por cartão, na ordem em que aparecem na legenda. */
	byCard: { cardId: string; cents: Cents }[];
}

/**
 * Onde cada parcela cai. O banco manda só as que já existem; as que faltam (antes da primeira e depois da
 * última) entram no mês correspondente, pelo valor da última vista — a mesma estimativa do "faltam".
 */
function scheduleAmounts(group: InstallmentGroupLike): { month: MonthKey; cents: Cents }[] {
	const known = group.installments.filter(
		(t): t is InstallmentLike & { invoiceMonth: MonthKey; installmentNumber: number } =>
			t.invoiceMonth !== null && t.installmentNumber !== null,
	);
	if (known.length === 0) {
		return group.installments.flatMap((t) =>
			t.invoiceMonth !== null ? [{ month: t.invoiceMonth, cents: t.amountCents }] : [],
		);
	}
	const byNumber = new Map(known.map((t) => [t.installmentNumber, t]));
	const anchor = known.reduce((a, b) => (a.installmentNumber > b.installmentNumber ? a : b));
	const out: { month: MonthKey; cents: Cents }[] = [];
	for (let n = 1; n <= group.count; n += 1) {
		const row = byNumber.get(n);
		out.push(
			row
				? { month: row.invoiceMonth, cents: row.amountCents }
				: { month: addMonths(anchor.invoiceMonth, n - anchor.installmentNumber), cents: anchor.amountCents },
		);
	}
	return out;
}

/** Até `max` meses, com `from` sempre no meio do que couber: primeiro os seguintes, depois os anteriores. */
function chartMonths(months: readonly MonthKey[], from: MonthKey, max: number): MonthKey[] {
	const sorted = [...new Set(months)].sort();
	if (!sorted.includes(from)) sorted.push(from);
	sorted.sort();
	if (sorted.length <= max) return sorted;
	const future = sorted.filter((m) => m >= from).slice(0, max);
	const room = max - future.length;
	const past = sorted.filter((m) => m < from).slice(-room);
	return [...past, ...future];
}

/**
 * Colunas do gráfico: meses anteriores, o atual e os seguintes (até `max`). A tela mostra oito de cada vez,
 * começando no mês atual. `cardOrder` fixa a ordem das fatias. Sem parcela, fica só o mês atual vazio.
 */
export function monthColumns(
	groups: readonly InstallmentGroupLike[],
	from: MonthKey,
	cardOrder: readonly string[],
	max = 24,
): MonthColumn[] {
	const perMonth = new Map<MonthKey, Map<string, Cents>>();
	for (const g of activeGroups(groups)) {
		if (g.cardId === null) continue;
		for (const t of scheduleAmounts(g)) {
			const per = perMonth.get(t.month) ?? new Map<string, Cents>();
			per.set(g.cardId, (per.get(g.cardId) ?? 0) + t.cents);
			perMonth.set(t.month, per);
		}
	}
	const months = perMonth.size === 0 ? [from] : chartMonths([...perMonth.keys()], from, max);
	return months.map((month) => {
		const per = perMonth.get(month);
		const byCard = cardOrder.flatMap((cardId) => {
			const cents = per?.get(cardId) ?? 0;
			return cents > 0 ? [{ cardId, cents }] : [];
		});
		return { month, totalCents: byCard.reduce((s, p) => s + p.cents, 0), byCard };
	});
}

/** "NOV", "DEZ": três letras em caixa alta, como no Figma. */
export function monthAbbrev(month: MonthKey): string {
	return monthName(month).slice(0, 3).toLocaleUpperCase("pt-BR");
}

export interface InstallmentCardModel {
	groupId: string;
	title: string;
	cardId: string | null;
	/** "Parcela 11 de 21". */
	progressLabel: string;
	/** Valor da parcela (a vista da fatura vigente). */
	currentCents: Cents;
	paidCents: Cents;
	remainingCents: Cents;
	paidEstimated: boolean;
	remainingEstimated: boolean;
	percent: number;
	/** "Última parcela em agosto de 2027 · faltam 10". */
	endLabel: string;
}

/** Cartão de um parcelamento: tudo pela parcela vista (n de N), como o servidor contou. */
export function installmentCard(group: InstallmentGroupLike): InstallmentCardModel {
	const left = group.remainingCount;
	const end = group.lastInvoiceMonth
		? `Última parcela em ${monthYear(group.lastInvoiceMonth)}`
		: "Sem data da última parcela";
	return {
		groupId: group.groupId,
		title: group.description || "Compra parcelada",
		cardId: group.cardId,
		progressLabel: group.currentNumber
			? `Parcela ${group.currentNumber} de ${group.count}`
			: `${group.count} parcelas`,
		currentCents: group.installmentCents,
		paidCents: group.paidCents,
		remainingCents: group.remainingCents,
		paidEstimated: group.paidEstimated,
		remainingEstimated: group.remainingEstimated,
		percent: percentOf(group.paidCents, group.totalCents),
		endLabel: `${end} · ${left === 1 ? "falta 1" : `faltam ${left}`}`,
	};
}

/** Maior saldo a pagar primeiro; `cardId` filtra por cartão (null = todos). */
export function visibleInstallments(
	groups: readonly InstallmentGroupLike[],
	cardId: string | null,
): InstallmentCardModel[] {
	return activeGroups(groups)
		.filter((g) => cardId === null || g.cardId === cardId)
		.map((g) => installmentCard(g))
		.sort((a, b) => b.remainingCents - a.remainingCents || a.title.localeCompare(b.title, "pt-BR"));
}

// ---------------------------------------------------------------- limites

export interface LimitRow {
	cardId: string;
	limitCents: Cents | null;
	usedCents: Cents;
}

export interface LimitsOverview {
	/** Soma só dos cartões que têm limite. */
	totalLimitCents: Cents;
	usedCents: Cents;
	availableCents: Cents;
	/** Cartões com limite informado (entram na soma). */
	countedCards: number;
	/** Cartões sem limite informado pelo banco. */
	missingLimit: number;
	overLimit: boolean;
}

export function limitsOverview(rows: readonly LimitRow[]): LimitsOverview {
	let totalLimitCents = 0;
	let usedCents = 0;
	let countedCards = 0;
	for (const r of rows) {
		if (r.limitCents === null || r.limitCents <= 0) continue;
		totalLimitCents += r.limitCents;
		usedCents += r.usedCents;
		countedCards += 1;
	}
	return {
		totalLimitCents,
		usedCents,
		availableCents: Math.max(0, totalLimitCents - usedCents),
		countedCards,
		missingLimit: rows.length - countedCards,
		overLimit: usedCents > totalLimitCents,
	};
}

/** Percentual usado de um cartão (pode passar de 100; a barra é que trava). `null` sem limite. */
export function usagePercent(usedCents: Cents, limitCents: Cents | null): number | null {
	if (limitCents === null || limitCents <= 0) return null;
	return percentOf(usedCents, limitCents);
}

/** Fatias da barra geral: cada cartão com o que usa, e o resto em cinza. */
export function limitBar(
	rows: readonly (LimitRow & { color: string })[],
	overview: Pick<LimitsOverview, "availableCents" | "overLimit">,
	trackColor: string,
) {
	const parts = rows
		.filter((r) => r.limitCents !== null && r.limitCents > 0 && r.usedCents > 0)
		.map((r) => ({ key: r.cardId, color: r.color, weight: r.usedCents }));
	if (!overview.overLimit && overview.availableCents > 0) {
		parts.push({ key: "available", color: trackColor, weight: overview.availableCents });
	}
	return parts;
}

/** "Fecha dia 31 · vence dia 7". */
export function cycleLabel(card: Pick<CardLike, "closingDay" | "dueDay">): string {
	return `Fecha dia ${card.closingDay} · vence dia ${card.dueDay}`;
}

/** Dia do mês do "melhor dia de compra" (hoje ou o próximo), calculado pelo engine. */
export function bestPurchaseDay(card: CardLike, today: LocalDate): number {
	return Number(nextBestPurchaseDate(today, card).slice(8, 10));
}

/** Dias até o vencimento, para o aviso de "vence em N dias" no cartão. */
export function dueInLabel(dueDate: LocalDate, today: LocalDate): string {
	const days = daysBetween(today, dueDate);
	if (days < 0) return `Venceu há ${pluralDays(-days)}`;
	return days === 0 ? "Vence hoje" : `Vence em ${pluralDays(days)}`;
}
