import { type Cents, daysBetween, invoiceFor, type LocalDate, type MonthKey } from "@orbita/core";
import { banks, chart, chartSeries, colors } from "@orbita/tokens";
import { bankLogoKey } from "../../lib/bank-logos.ts";
import { percentOf, pluralDays } from "../../lib/format.ts";
import type { BankBadge } from "../../ui/index.ts";
import { initialOf } from "./transaction-model.ts";

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
 * O mesmo gasto do orçamento, uma linha por categoria. As cinco cores do gráfico continuam nos
 * espaços 0..4; categoria sem espaço fica cinza, com o próprio nome. O que não tem categoria entra
 * em Outros. Categoria sem gasto não entra.
 */
export function categoryShares(
	byCategory: Readonly<Record<string, Cents>>,
	categories: readonly CategoryLike[],
): CategoryShare[] {
	const byId = new Map(categories.map((c) => [c.id, c]));
	const slots = new Map<number, CategoryShare>();
	const rest: CategoryShare[] = [];
	let loose = 0;
	for (const [id, cents] of Object.entries(byCategory)) {
		if (cents <= 0) continue;
		const category = byId.get(id);
		const slot = category?.chartSlot;
		const color = slot === null || slot === undefined ? undefined : chartSeries[slot];
		if (category && slot !== null && slot !== undefined && color) {
			const current = slots.get(slot);
			if (current) current.cents += cents;
			else slots.set(slot, { key: `slot-${slot}`, name: category.name, color, cents });
		} else if (category) {
			rest.push({ key: category.id, name: category.name, color: chart.other, cents });
		} else {
			loose += cents;
		}
	}
	const shares = [...slots.entries()].sort(([a], [b]) => a - b).map(([, share]) => share);
	rest.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
	if (loose > 0) {
		const outros = rest.find((share) => share.name === "Outros");
		if (outros) outros.cents += loose;
		else rest.push({ key: "other", name: "Outros", color: chart.other, cents: loose });
	}
	return [...shares, ...rest];
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

/** Cor da marca pelo ISPB do logo. Banco sem cor no design system usa o genérico. */
const LOGO_COLOR: Readonly<Record<string, string>> = {
	"18236120": banks.nubank,
	"00416968": banks.inter,
	"90400888": banks.santander,
	"10573521": banks.mercadoPago,
	"60701190": banks.itau,
	"31872495": banks.c6,
	"22896431": banks.picpay,
	"60746948": banks.bradesco,
};

/**
 * Cor da marca do banco. Com `name`, o nome também identifica (o Meu Pluggy muitas vezes não manda o ISPB).
 * Banco que o design system não conhece usa o genérico.
 */
export function bankColor(bankCode: string | null, name?: string | null): string {
	const key = bankLogoKey({ bankCode, name });
	return (key && LOGO_COLOR[key]) || banks.generic;
}

/** O círculo de uma conta, cartão ou conexão: logo do banco se for conhecido (pelo ISPB ou pelo nome), senão a inicial. */
export function bankBadge(source: { name: string; bankCode?: string | null | undefined }): BankBadge {
	return {
		initial: initialOf(source.name),
		color: bankColor(source.bankCode ?? null, source.name),
		logo: bankLogoKey(source),
	};
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
