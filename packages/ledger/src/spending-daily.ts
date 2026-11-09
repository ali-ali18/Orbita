import {
	addMonths,
	daysInMonth,
	type LocalDate,
	type MonthKey,
	merchantKey,
	monthOf,
	parseLocalDate,
	parseMonthKey,
	serviceDisplayName,
} from "@orbita/core";
import type { Stores, TransactionRecord } from "@orbita/db";
import type { SpendingDailyResponse } from "@orbita/shared";
import { spendingOfMonth } from "./summary.ts";

const TOP_MERCHANTS = 3;

const percentChange = (now: number, before: number): number | null =>
	before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null;

/** Dia do mês (1 a `days`) em que o lançamento pesa: o da data; o que a data põe em outro mês (parcela) pesa no dia 1. */
function dayOf(t: TransactionRecord, month: MonthKey, days: number, through: number): number {
	const day = monthOf(t.date) === month ? parseLocalDate(t.date).day : 1;
	return Math.max(1, Math.min(day, days, through));
}

/**
 * Gasto acumulado dia a dia do mês (até hoje, ou o mês inteiro se já fechou) e do anterior (inteiro), para a linha
 * e o tracejado. Parte do Gasto OFICIAL (`spendingOfMonth`): o último ponto é exatamente o `spentCents` do Início; se
 * o abatimento de estornos por categoria faz a soma simples das linhas diferir, a diferença vai para o último dia.
 */
async function cumulative(stores: Stores, month: MonthKey, today: LocalDate, through: number, days: number) {
	const { txs, spentCents } = await spendingOfMonth(stores, month, today);
	const perDay = new Array<number>(days + 1).fill(0);
	let rowsCents = 0;
	for (const t of txs) {
		if (t.kind !== "expense" && t.kind !== "refund") continue;
		const delta = t.kind === "refund" ? -t.amountCents : t.amountCents;
		const day = dayOf(t, month, days, Math.max(1, through));
		perDay[day] = (perDay[day] ?? 0) + delta;
		rowsCents += delta;
	}
	if (through >= 1) perDay[through] = (perDay[through] ?? 0) + (spentCents - rowsCents);
	const points: { day: number; cumulativeCents: number }[] = [];
	let acc = 0;
	for (let day = 1; day <= through; day++) {
		acc += perDay[day] ?? 0;
		points.push({ day, cumulativeCents: acc });
	}
	return { txs, spentCents, points };
}

/** Nome curto e limpo do estabelecimento: o do catálogo de serviços, ou as 2 primeiras palavras sem números. */
function merchantLabel(text: string): string {
	const known = serviceDisplayName(text);
	if (known) return known;
	const words = text
		.replace(/[*_.]+/g, " ")
		.split(/\s+/)
		.filter((w) => w.length > 0 && !/^\d+([/-]\d+)*$/.test(w))
		.slice(0, 2);
	const joined = words.join(" ");
	const shout = joined === joined.toLocaleUpperCase("pt-BR");
	return shout
		? words
				.map((w) => w.charAt(0).toLocaleUpperCase("pt-BR") + w.slice(1).toLocaleLowerCase("pt-BR"))
				.join(" ")
		: joined;
}

/** Os maiores estabelecimentos do mês: só despesa, agrupada pelo nome limpo (a mesma loja com códigos diferentes soma). */
function topMerchants(txs: readonly TransactionRecord[]): SpendingDailyResponse["topMerchants"] {
	const groups = new Map<string, { name: string; totalCents: number; count: number }>();
	for (const t of txs) {
		if (t.kind !== "expense") continue;
		const text = (t.merchantName ?? t.description).trim();
		const known = serviceDisplayName(text);
		const key = known ? `svc:${known}` : merchantKey(text, 2);
		if (key === "") continue;
		const g = groups.get(key) ?? { name: merchantLabel(text), totalCents: 0, count: 0 };
		g.totalCents += t.amountCents;
		g.count += 1;
		groups.set(key, g);
	}
	return [...groups.values()]
		.sort((a, b) => b.totalCents - a.totalCents || b.count - a.count || a.name.localeCompare(b.name, "pt-BR"))
		.slice(0, TOP_MERCHANTS);
}

export async function spendingDaily(
	stores: Stores,
	month: MonthKey,
	today: LocalDate,
): Promise<SpendingDailyResponse> {
	const previousMonth = addMonths(month, -1);
	const days = daysInMonth(parseMonthKey(month).year, parseMonthKey(month).month);
	const prevDays = daysInMonth(parseMonthKey(previousMonth).year, parseMonthKey(previousMonth).month);
	const thisMonth = monthOf(today);
	const through = month === thisMonth ? parseLocalDate(today).day : month < thisMonth ? days : 0;
	const [cur, prev] = await Promise.all([
		cumulative(stores, month, today, through, days),
		cumulative(stores, previousMonth, today, prevDays, prevDays),
	]);
	const sameDay = through === 0 ? 0 : (prev.points[Math.min(through, prevDays) - 1]?.cumulativeCents ?? 0);
	const nowCents = cur.points.at(-1)?.cumulativeCents ?? 0;
	return {
		month,
		previousMonth,
		spentCents: cur.spentCents,
		previousSpentCents: prev.spentCents,
		throughDay: through,
		daysInMonth: days,
		current: cur.points,
		previous: prev.points,
		previousSameDayCents: sameDay,
		variancePercent: through === 0 ? null : percentChange(nowCents, sameDay),
		topMerchants: topMerchants(cur.txs),
	};
}
