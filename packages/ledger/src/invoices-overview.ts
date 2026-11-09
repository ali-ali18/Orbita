import {
	addMonths,
	type Cents,
	invoiceFor,
	type LocalDate,
	type MonthKey,
	monthOf,
	projectMissingInstallments,
} from "@orbita/core";
import { type BillRecord, type CardRecord, type Stores, toCardConfig } from "@orbita/db";
import type {
	CardLimitDto,
	InvoiceHistoryPointDto,
	InvoiceState,
	InvoiceTotalSource,
	LimitsTotalDto,
} from "@orbita/shared";
import { activeInstallments, cardInvoice } from "./summary.ts";

/** Quantos meses de fatura o gráfico de barras mostra até o mês aberto (o aberto é o último desses). */
export const INVOICE_HISTORY_MONTHS = 6;
/** Até quantos meses depois do aberto o gráfico olha atrás de fatura já com valor (parcelas e lançamentos futuros). */
export const INVOICE_FUTURE_MONTHS = 3;

/** Situação de um mês com vários cartões: a mais urgente (vencida, fechada, aberta); paga só se todas estão. */
export function monthState(states: readonly InvoiceState[]): InvoiceState {
	for (const s of ["overdue", "closed", "open"] as const) if (states.includes(s)) return s;
	return "paid";
}

/**
 * Uma fatura como a visão "Faturas" a mostra. Fechada com fatura do banco (`/bills`): total e pagamentos vêm dele;
 * senão (e sempre na aberta, que o banco não manda) é a soma dos lançamentos do engine (`cardInvoice`).
 */
export interface InvoiceLine {
	month: MonthKey;
	closingDate: LocalDate;
	dueDate: LocalDate;
	status: "open" | "closed" | "overdue";
	paymentStatus: "paid" | "partial" | "unpaid" | "open";
	/** Situação honesta para o app: paga, fechada (a vencer), vencida ou aberta. */
	state: InvoiceState;
	/** De onde vêm `totalCents` e `paidCents`. */
	source: InvoiceTotalSource;
	/** Quando o Órbita leu a fatura no banco (`source` "bank"); senão `null`. */
	bankSyncedAt: string | null;
	totalCents: Cents;
	paidCents: Cents;
	/** O que ainda se deve nesta fatura: o total se ainda aberta; o total menos o pago se fechada (nunca negativo). */
	owedCents: Cents;
}

export interface CardInvoicesLine {
	card: CardRecord;
	/** A fatura que vence neste mês (a que se paga agora). */
	due: InvoiceLine;
	/** A fatura aberta de hoje; é a mesma de `due` quando ela já vence neste mês. */
	open: InvoiceLine;
	/** Soma do que se deve neste cartão: a aberta mais as fechadas ainda não pagas. */
	owedCents: Cents;
	/** O vencimento mais próximo ainda por pagar (fechada com saldo; senão o da aberta, se tem compra). */
	nextDueDate: LocalDate | null;
	/** Limite em uso (o mesmo de `limit.usedCents`; mantido por compatibilidade). */
	usedLimitCents: Cents;
	/** Limite, disponível e usado, com a idade da leitura do banco. */
	limit: CardLimitDto;
}

export interface InvoicesOverview {
	cards: CardInvoicesLine[];
	/** O que ainda se deve em todos os cartões (aberta mais fechadas sem pagar; fatura paga nunca entra). */
	owedCents: Cents;
	nextDueDate: LocalDate | null;
	/** Limites de todos os cartões somados. */
	limits: LimitsTotalDto;
	/** Total de faturas por mês: 6 até a aberta, mais os meses seguintes que já têm fatura; para o gráfico de barras. */
	history: InvoiceHistoryPointDto[];
}

/** Os meses que o overview olha por cartão: a aberta, a anterior a ela, o mês atual e o anterior do calendário. */
function consideredMonths(card: CardRecord, today: LocalDate): Set<MonthKey> {
	const thisMonth = monthOf(today);
	const openMonth = invoiceFor(today, toCardConfig(card)).month;
	return new Set([addMonths(thisMonth, -1), thisMonth, addMonths(openMonth, -1), openMonth]);
}

/** O que ainda se deve numa fatura: o total se aberta; o total menos o pago se fechada (nunca negativo). */
export function invoiceOwedCents(status: InvoiceLine["status"], totalCents: Cents, paidCents: Cents): Cents {
	return status === "open" ? Math.max(0, totalCents) : Math.max(0, totalCents - paidCents);
}

const sum = (values: Iterable<number>) => {
	let total = 0;
	for (const v of values) total += v;
	return total;
};

/** A fatura do banco de `month`: o mês do vencimento é o mês da fatura. */
const billOfMonth = (bills: readonly BillRecord[], month: MonthKey): BillRecord | null =>
	bills
		.filter((b) => monthOf(b.dueDate) === month)
		.sort((a, b) => b.syncedAt.getTime() - a.syncedAt.getTime())[0] ?? null;

async function lineOf(
	stores: Stores,
	cardId: string,
	bills: readonly BillRecord[],
	month: MonthKey,
	today: LocalDate,
): Promise<InvoiceLine> {
	const { invoice, composition } = await cardInvoice(stores, cardId, month, today);
	const bill = invoice.status === "open" ? null : billOfMonth(bills, month);
	if (!bill) {
		const totalCents = composition.totalCents;
		return {
			month,
			closingDate: invoice.closingDate,
			dueDate: invoice.dueDate,
			status: invoice.status,
			paymentStatus: invoice.paymentStatus,
			state: stateOf(invoice.status, invoice.paymentStatus),
			source: "ledger",
			bankSyncedAt: null,
			totalCents,
			paidCents: invoice.paidCents,
			owedCents: invoiceOwedCents(invoice.status, totalCents, invoice.paidCents),
		};
	}
	// O banco registra o pagamento da fatura N nos `payments` da N+1 (doc da Pluggy). Sem a N+1 ainda (é a última
	// fechada), só resta o `card_payment` casado. As duas medidas são do MESMO pagamento: vale a maior, nunca a soma.
	const next = billOfMonth(bills, addMonths(month, 1));
	const bankPaid = next ? sum(next.payments.map((p) => p.amountCents)) : 0;
	const paidCents = Math.max(bankPaid, invoice.paidCents);
	const totalCents = bill.totalAmountCents;
	const dueDate = bill.dueDate;
	const status = dueDate < today ? "overdue" : "closed";
	const paymentStatus =
		totalCents <= 0 || paidCents >= totalCents ? "paid" : paidCents > 0 ? "partial" : "unpaid";
	return {
		month,
		closingDate: bill.closeDate ?? invoice.closingDate,
		dueDate,
		status,
		paymentStatus,
		state: stateOf(status, paymentStatus),
		source: "bank",
		bankSyncedAt: bill.syncedAt.toISOString(),
		totalCents,
		paidCents,
		owedCents: invoiceOwedCents(status, totalCents, paidCents),
	};
}

function stateOf(status: InvoiceLine["status"], paymentStatus: InvoiceLine["paymentStatus"]): InvoiceState {
	if (status === "open") return "open";
	if (paymentStatus === "paid") return "paid";
	return status === "overdue" ? "overdue" : "closed";
}

/**
 * Tolerâncias da conferência do limite: centavos de arredondamento entre limite, disponível e saldo; e quanto o "usado"
 * do banco pode passar do que o Órbita sabe dever (R$ 100 ou 5 % do limite, o que for maior) antes de ser incoerente.
 */
export const LIMIT_ROUNDING_CENTS = 100;
export const LIMIT_COHERENCE_FLOOR_CENTS = 10_000;
export const LIMIT_COHERENCE_PERCENT = 5;

/**
 * Limite do cartão (docs/pluggy.md, "Limite do cartão"). Com o disponível do banco (A), o limite (L) e o saldo do
 * cartão (B, o que se deve):
 * 1. L − A = B (±R$ 1): o limite é o do banco e usado = L − A (Inter, Mercado Pago e Santander, nos dados reais);
 * 2. L − A ≠ B e A + B < L: o dono baixou o limite no app do banco (ex.: aprovado 10.000, disponível 2.000,
 *    saldo 500). O limite efetivo é A + B (2.500) e o usado é B; o aprovado vai em `approvedLimitCents`. Só vale se
 *    B ≥ o que o Órbita sabe dever (`owedCents`) menos R$ 1: um saldo menor é velho ou de antes da fatura fechada
 *    (não pago) e das compras novas, e não prova limite baixado; cai na estimativa;
 * 3. sem saldo do banco, ou A + B ≥ L (não fecha de jeito nenhum): se L − A passa do que o Órbita sabe dever
 *    (`plausibleUsedCents`) por mais que a tolerância, o usado é a estimativa por lançamentos (`estimated`), com o
 *    disponível do banco; senão L − A.
 * Sem o disponível (cartão manual ou ainda não lido): a estimativa (`estimatedUsedCents`, o que se deve mais as
 * parcelas futuras).
 */
export function cardLimit(
	card: CardRecord,
	estimatedUsedCents: Cents,
	plausibleUsedCents: Cents = Number.POSITIVE_INFINITY,
	owedCents: Cents = 0,
): CardLimitDto {
	const { limitCents, availableCents, balanceCents } = card;
	const syncedAt = card.limitSyncedAt?.toISOString() ?? null;
	if (limitCents !== null && availableCents !== null) {
		const bankUsed = Math.max(0, limitCents - availableCents);
		if (balanceCents !== null) {
			if (Math.abs(bankUsed - balanceCents) <= LIMIT_ROUNDING_CENTS) {
				return { limitCents, availableCents, usedCents: bankUsed, source: "bank", syncedAt };
			}
			if (availableCents + balanceCents < limitCents && balanceCents >= owedCents - LIMIT_ROUNDING_CENTS) {
				return {
					limitCents: availableCents + balanceCents,
					approvedLimitCents: limitCents,
					availableCents,
					usedCents: Math.max(0, balanceCents),
					source: "bank",
					syncedAt,
				};
			}
		}
		const tolerance = Math.max(
			LIMIT_COHERENCE_FLOOR_CENTS,
			Math.round((limitCents * LIMIT_COHERENCE_PERCENT) / 100),
		);
		const coherent = bankUsed <= plausibleUsedCents + tolerance;
		if (coherent) return { limitCents, availableCents, usedCents: bankUsed, source: "bank", syncedAt };
		// Incoerente (o dono baixou o limite e o saldo ainda não foi lido): usado = estimativa por lançamentos e o limite
		// efetivo é disponível + usado, para o % e o total não misturarem o aprovado com o efetivo.
		const effective = availableCents + estimatedUsedCents;
		return {
			limitCents: Math.min(effective, limitCents),
			...(effective < limitCents ? { approvedLimitCents: limitCents } : {}),
			availableCents,
			usedCents: estimatedUsedCents,
			source: "estimated",
			syncedAt,
		};
	}
	return {
		limitCents,
		availableCents: limitCents === null ? null : Math.max(0, limitCents - estimatedUsedCents),
		usedCents: estimatedUsedCents,
		source: limitCents === null ? "none" : "estimated",
		syncedAt: null,
	};
}

function limitsTotal(limits: readonly CardLimitDto[]): LimitsTotalDto {
	const counted = limits.filter((l) => l.limitCents !== null);
	const synced = limits.flatMap((l) => (l.source === "bank" && l.syncedAt ? [l.syncedAt] : [])).sort();
	return {
		limitCents: sum(counted.map((l) => l.limitCents as Cents)),
		usedCents: sum(counted.map((l) => l.usedCents)),
		availableCents: sum(counted.map((l) => l.availableCents ?? 0)),
		cardsCounted: counted.length,
		cardsWithoutLimit: limits.length - counted.length,
		oldestSyncedAt: synced[0] ?? null,
	};
}

/**
 * "Faturas" do Início: para cada cartão ativo, a fatura a pagar (com o pago e o que falta), a aberta e o quanto
 * ainda se deve (a aberta mais as fechadas sem pagar, já descontados os pagamentos), o limite (do banco, com
 * fallback para a estimativa) e a série dos últimos 6 meses.
 *
 * Meses olhados: a aberta, a anterior a ela (a fechada que está para vencer, mesmo quando vence só no mês seguinte
 * ao fechamento) e o mês anterior e o atual do calendário (vencida há pouco). Fatura mais velha sem pagamento
 * registrado é histórico anterior ao Órbita, não dívida. `due` é a fechada com saldo de vencimento mais próximo;
 * sem nenhuma, a fechada que ainda vai vencer; por fim, a que vence neste mês.
 */
export async function invoicesOverview(stores: Stores, today: LocalDate): Promise<InvoicesOverview> {
	const cards = (await stores.cards.list()).filter((c) => c.archivedAt === null);
	const thisMonth = monthOf(today);
	const installmentGroups = await activeInstallments(stores, thisMonth, today);
	const lines: CardInvoicesLine[] = [];
	const memo = new Map<string, InvoiceLine>();
	const billsByCard = new Map<string, BillRecord[]>();
	const line = async (card: CardRecord, month: MonthKey) => {
		const key = `${card.id}|${month}`;
		const hit = memo.get(key);
		if (hit) return hit;
		let bills = billsByCard.get(card.id);
		if (!bills) {
			bills = await stores.bills.listByCard(card.id);
			billsByCard.set(card.id, bills);
		}
		const made = await lineOf(stores, card.id, bills, month, today);
		memo.set(key, made);
		return made;
	};
	const openMonths: MonthKey[] = [];
	for (const card of cards) {
		const openMonth = invoiceFor(today, toCardConfig(card)).month;
		openMonths.push(openMonth);
		const months = [...consideredMonths(card, today)].sort();
		const byMonth = new Map<MonthKey, InvoiceLine>();
		for (const m of months) byMonth.set(m, await line(card, m));
		const all = [...byMonth.values()];
		const open = byMonth.get(openMonth) as InvoiceLine;
		const pending = all.filter((l) => l.owedCents > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
		const closed = all.filter((l) => l.status !== "open").sort((a, b) => a.dueDate.localeCompare(b.dueDate));
		const due =
			pending.find((l) => l.status !== "open") ??
			closed.find((l) => l.dueDate >= today) ??
			(byMonth.get(thisMonth) as InvoiceLine);
		const owedCents = all.reduce((total, l) => total + l.owedCents, 0);
		let futureCents = 0;
		let remainingCents = 0;
		// Parcelas que a fatura aberta já projeta (a que o banco ainda não lançou): estão no devido e não contam de novo.
		const realOpen = await stores.transactions.listByInvoice(card.id, openMonth);
		for (const g of installmentGroups) {
			if (g.cardId !== card.id || g.remainingCount <= 0) continue;
			const projectedCents = projectMissingInstallments([g], card.id, openMonth, realOpen).reduce(
				(total, p) => total + p.amountCents,
				0,
			);
			// Tudo que ainda falta do parcelamento: a vigente (que já está na fatura aberta ou na fechada devida) e as
			// seguintes, lançadas ou não pelo banco (as que faltam são estimadas pelo valor da vigente).
			remainingCents += g.remainingCents;
			futureCents += Math.max(
				0,
				g.remainingCents - (g.currentNumber === null ? 0 : g.installmentCents) - projectedCents,
			);
		}
		// Sem nenhum dado do Órbita sobre o cartão (nem fatura do banco, nem lançamento) não há com o que conferir o
		// número do banco: vale como veio.
		const knowsCard = (billsByCard.get(card.id)?.length ?? 0) > 0 || owedCents + remainingCents > 0;
		const limit = cardLimit(
			card,
			owedCents + futureCents,
			// A parcela vigente já está em `owedCents`: só as que faltam depois dela entram (`futureCents`), sem contar duas vezes.
			knowsCard ? owedCents + futureCents : Number.POSITIVE_INFINITY,
			owedCents,
		);
		lines.push({
			card,
			due,
			open,
			owedCents,
			nextDueDate: pending[0]?.dueDate ?? null,
			usedLimitCents: limit.usedCents,
			limit,
		});
	}

	const lastMonth = openMonths.sort().at(-1) ?? thisMonth;
	const history: InvoiceHistoryPointDto[] = [];
	const pointOf = async (month: MonthKey, future = false): Promise<InvoiceHistoryPointDto> => {
		const own = await Promise.all(
			cards.map(async (card) => {
				const l = await line(card, month);
				// Fora dos meses que o overview considera, fechada sem pagamento conhecido é histórico (anterior ao
				// Órbita), não dívida: estado neutro, nunca "overdue".
				const considered = consideredMonths(card, today);
				return {
					card,
					l: l.state === "overdue" && !considered.has(month) ? { ...l, state: "closed" as const } : l,
				};
			}),
		);
		return {
			month,
			totalCents: sum(own.map((o) => Math.max(0, o.l.totalCents))),
			// Mês depois do aberto: `open` fica falso (o app antigo destaca o último `open`); o `state` continua "open".
			open: !future && own.some((o) => o.l.status === "open"),
			state: monthState(own.map((o) => o.l.state)),
			byCard: own.map((o) => ({
				cardId: o.card.id,
				totalCents: Math.max(0, o.l.totalCents),
				state: o.l.state,
			})),
		};
	};
	for (let i = INVOICE_HISTORY_MONTHS - 1; i >= 0; i--) history.push(await pointOf(addMonths(lastMonth, -i)));
	// Meses depois do aberto só entram até o último que já tem fatura (parcelas, compras futuras).
	const future: InvoiceHistoryPointDto[] = [];
	for (let i = 1; i <= INVOICE_FUTURE_MONTHS; i++) future.push(await pointOf(addMonths(lastMonth, i), true));
	const lastWithValue = future.findLastIndex((p) => p.totalCents > 0);
	history.push(...future.slice(0, lastWithValue + 1));

	const dates = lines.flatMap((l) => (l.nextDueDate ? [l.nextDueDate] : [])).sort();
	return {
		cards: lines,
		owedCents: lines.reduce((total, l) => total + l.owedCents, 0),
		nextDueDate: dates[0] ?? null,
		limits: limitsTotal(lines.map((l) => l.limit)),
		history,
	};
}
