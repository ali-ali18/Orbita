import { type Cents, daysBetween, invoiceFor, type LocalDate, type MonthKey } from "@orbita/core";
import { banks, chart, chartSeries, colors } from "@orbita/tokens";
import { percentOf, pluralDays } from "../../lib/format.ts";

/*
 * Funções puras que montam o que a tela Início mostra a partir das respostas da API. Nenhuma
 * conta de dinheiro nova: os números vêm do engine (servidor); aqui só se escolhe cor, ordem e texto.
 */

export interface CategoryLike {
	id: string;
	name: string;
	chartSlot: number | null;
}

export interface BarSegment {
	key: string;
	color: string;
	/** Peso do segmento (centavos). A barra usa `flex` com estes valores. */
	weight: Cents;
}

export interface CategoryShare {
	/** `slot-N` ou `other`. */
	key: string;
	name: string;
	color: string;
	cents: Cents;
}

/**
 * Gasto por categoria agrupado em até 5 cores + "Outros" (nunca uma 6ª cor). Categorias sem
 * espaço no gráfico (e as desconhecidas) somam em "Outros". Ordem: espaços 0..4, depois Outros;
 * categoria sem gasto não entra.
 */
export function categoryShares(
	byCategory: Readonly<Record<string, Cents>>,
	categories: readonly CategoryLike[],
): CategoryShare[] {
	const byId = new Map(categories.map((c) => [c.id, c]));
	const slots = new Map<number, CategoryShare>();
	let otherCents = 0;
	for (const [id, cents] of Object.entries(byCategory)) {
		if (cents <= 0) continue;
		const category = byId.get(id);
		const slot = category?.chartSlot;
		const color = slot === null || slot === undefined ? undefined : chartSeries[slot];
		if (category && slot !== null && slot !== undefined && color) {
			const current = slots.get(slot);
			if (current) current.cents += cents;
			else slots.set(slot, { key: `slot-${slot}`, name: category.name, color, cents });
		} else {
			otherCents += cents;
		}
	}
	const shares = [...slots.entries()].sort(([a], [b]) => a - b).map(([, share]) => share);
	if (otherCents > 0) shares.push({ key: "other", name: "Outros", color: chart.other, cents: otherCents });
	return shares;
}

export function shareSegments(shares: readonly CategoryShare[]): BarSegment[] {
	return shares.map((s) => ({ key: s.key, color: s.color, weight: s.cents }));
}

export interface InstallmentGroupLike {
	remainingCount: number;
	installments: readonly { invoiceMonth: MonthKey | null; amountCents: Cents }[];
}

/** Parcelamentos que ainda têm parcela a pagar e quanto pesam na fatura do mês `month`. */
export function installmentsOverview(groups: readonly InstallmentGroupLike[], month: MonthKey) {
	const active = groups.filter((g) => g.remainingCount > 0);
	const monthlyCents = active.reduce(
		(sum, g) =>
			sum +
			g.installments.reduce((inner, t) => (t.invoiceMonth === month ? inner + t.amountCents : inner), 0),
		0,
	);
	return { activeCount: active.length, monthlyCents };
}

export interface CardLike {
	closingDay: number;
	dueDay: number;
	closingRule: "closing-day-next" | "closing-day-included";
}

/** A fatura aberta de hoje (o mês dela é o do vencimento), calculada pelo engine. */
export function currentInvoiceMonth(card: CardLike, today: LocalDate): MonthKey {
	return invoiceFor(today, card).month;
}

/** Legenda da fatura: "Fecha em 3 dias", "Fecha hoje", "Vence em 5 dias", "Venceu há 2 dias". */
export function invoiceCaption(
	invoice: { status: "open" | "closed" | "overdue"; closingDate: LocalDate; dueDate: LocalDate },
	today: LocalDate,
): string {
	if (invoice.status === "open") {
		const days = daysBetween(today, invoice.closingDate);
		return days <= 0 ? "Fecha hoje" : `Fecha em ${pluralDays(days)}`;
	}
	if (invoice.status === "closed") {
		const days = daysBetween(today, invoice.dueDate);
		return days <= 0 ? "Vence hoje" : `Vence em ${pluralDays(days)}`;
	}
	return `Venceu há ${pluralDays(Math.max(1, daysBetween(invoice.dueDate, today)))}`;
}

/** Cor de fundo do círculo do banco pelo ISPB; banco que o design system não conhece usa o genérico. */
export function bankColor(bankCode: string | null): string {
	switch (bankCode) {
		case "18236120":
			return banks.nubank;
		case "00416968":
			return banks.inter;
		case "90400888":
			return banks.santander;
		case "10573521":
			return banks.mercadoPago;
		case "60701190":
			return banks.itau;
		default:
			return banks.generic;
	}
}

export interface HeroModel {
	spentCents: Cents;
	limitCents: Cents;
	/** O que o servidor diz que dá pra gastar (já desconta as contas a vencer). Pode ser negativo. */
	availableCents: Cents;
	/** Contas recorrentes do mês que ainda faltam pagar. */
	reservedCents: Cents;
	/** O que sobra do orçamento depois do gasto e das contas a vencer (nunca negativo). */
	freeCents: Cents;
	percent: number;
	/** Passou do orçamento: gasto maior que o limite (e só isso). */
	overBudget: boolean;
	/** Dentro do orçamento, mas as contas a vencer passam do que sobra. */
	reserveExceeds: boolean;
}

export function heroModel(input: {
	spentCents: Cents;
	limitCents: Cents;
	availableCents: Cents;
	reservedCents: Cents;
}): HeroModel {
	const { spentCents, limitCents, availableCents, reservedCents } = input;
	const overBudget = spentCents > limitCents;
	return {
		spentCents,
		limitCents,
		availableCents,
		reservedCents,
		freeCents: Math.max(0, limitCents - spentCents - reservedCents),
		percent: limitCents > 0 ? percentOf(spentCents, limitCents) : spentCents > 0 ? 100 : 0,
		overBudget,
		reserveExceeds: !overBudget && availableCents < 0,
	};
}

export const RESERVED_KEY = "reserved";
export const FREE_KEY = "free";

/**
 * Barra do hero em três partes: gasto por categoria, contas a vencer (listradas) e o livre.
 * Gastou além do limite: só o gasto, proporcional. Contas a vencer maiores que o que sobra
 * ocupam só o que sobra (a barra nunca passa de 100%).
 */
export function heroBarParts(
	shares: readonly CategoryShare[],
	hero: Pick<HeroModel, "spentCents" | "limitCents" | "reservedCents" | "freeCents">,
): (BarSegment & { striped?: boolean })[] {
	const parts: (BarSegment & { striped?: boolean })[] = shareSegments(shares);
	if (hero.spentCents > hero.limitCents) return parts;
	const room = Math.max(0, hero.limitCents - hero.spentCents);
	const reserved = Math.min(hero.reservedCents, room);
	if (reserved > 0)
		parts.push({ key: RESERVED_KEY, color: colors.surface3, weight: reserved, striped: true });
	if (hero.freeCents > 0) parts.push({ key: FREE_KEY, color: colors.surface3, weight: hero.freeCents });
	return parts;
}
