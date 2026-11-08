import { budgetStatus } from "./budget.ts";
import { passedThreshold } from "./budget-suggestion.ts";
import { daysBetween } from "./dates.ts";
import { medianCents, merchantKey } from "./merchant.ts";
import { assertCents } from "./money.ts";
import type { Cents, LocalDate } from "./types.ts";

/*
 * Detectores do Vigia. Funções puras, sem IA: decidem SE há um achado e com quais números (inteiros). O texto
 * do aviso é escrito depois (modelo fixo, e a IA só reescreve, quando liga).
 */

/** Uma despesa como o Vigia a vê. */
export interface WatchedSpend {
	id: string;
	date: LocalDate;
	amountCents: Cents;
	/** `null` = sem categoria (não entra na comparação por categoria). */
	categoryId: string | null;
	/** Estabelecimento (ou descrição) como veio do banco. */
	merchant: string;
	/** Parcela de compra parcelada não é "gasto fora do comum" nem cobrança repetida. */
	installmentGroupId?: string | null;
}

export const UNUSUAL_FACTOR = 3;
/** Quantas despesas anteriores da categoria são precisas para saber o que é "o usual". */
export const UNUSUAL_MIN_SAMPLES = 5;

export interface UnusualSpending {
	transactionId: string;
	categoryId: string;
	date: LocalDate;
	merchant: string;
	amountCents: Cents;
	/** Mediana das despesas anteriores da categoria. */
	medianCents: Cents;
	sampleCount: number;
}

/**
 * Gasto fora do usual: uma despesa recente que passa de `factor` vezes a MEDIANA das despesas anteriores da mesma
 * categoria (a mediana não se deixa levar por uma compra grande antiga) e de `minCents` (o piso de "gasto grande").
 * Sem `UNUSUAL_MIN_SAMPLES` anteriores na categoria, não há "usual" e não avisa. As recentes não entram na
 * própria mediana.
 */
export function detectUnusualSpending(input: {
	recent: readonly WatchedSpend[];
	history: readonly WatchedSpend[];
	minCents: Cents;
	factor?: number;
	minSamples?: number;
}): UnusualSpending[] {
	assertCents(input.minCents, "minCents");
	const factor = input.factor ?? UNUSUAL_FACTOR;
	const minSamples = input.minSamples ?? UNUSUAL_MIN_SAMPLES;
	const recentIds = new Set(input.recent.map((t) => t.id));
	const byCategory = new Map<string, Cents[]>();
	for (const t of input.history) {
		if (t.categoryId === null || t.installmentGroupId || recentIds.has(t.id)) continue;
		assertCents(t.amountCents, "amountCents");
		const list = byCategory.get(t.categoryId) ?? [];
		list.push(t.amountCents);
		byCategory.set(t.categoryId, list);
	}
	const found: UnusualSpending[] = [];
	for (const t of input.recent) {
		if (t.categoryId === null || t.installmentGroupId) continue;
		assertCents(t.amountCents, "amountCents");
		const samples = byCategory.get(t.categoryId);
		if (!samples || samples.length < minSamples) continue;
		const usual = medianCents(samples);
		if (t.amountCents >= input.minCents && t.amountCents > usual * factor) {
			found.push({
				transactionId: t.id,
				categoryId: t.categoryId,
				date: t.date,
				merchant: t.merchant,
				amountCents: t.amountCents,
				medianCents: usual,
				sampleCount: samples.length,
			});
		}
	}
	return found.sort((a, b) =>
		a.date < b.date ? -1 : a.date > b.date ? 1 : a.transactionId < b.transactionId ? -1 : 1,
	);
}

export interface DuplicateCharge {
	/** A cobrança repetida (a mais nova do par). */
	transactionId: string;
	/** A primeira do par. */
	firstTransactionId: string;
	merchant: string;
	amountCents: Cents;
	firstDate: LocalDate;
	date: LocalDate;
	daysApart: number;
}

/**
 * Cobrança repetida: mesmo estabelecimento e mesmo valor em até `windowDays` dias (0 = no mesmo dia). Só
 * `since` em diante é novidade (as mais velhas já foram avisadas); o par pode usar uma anterior a `since`.
 * Parcelas do mesmo parcelamento não contam.
 */
export function detectDuplicateCharges(input: {
	transactions: readonly WatchedSpend[];
	windowDays: number;
	since: LocalDate;
}): DuplicateCharge[] {
	if (!Number.isInteger(input.windowDays) || input.windowDays < 0) {
		throw new RangeError("a janela deve ser um inteiro de dias, zero ou mais");
	}
	const groups = new Map<string, WatchedSpend[]>();
	for (const t of input.transactions) {
		assertCents(t.amountCents, "amountCents");
		const key = merchantKey(t.merchant);
		if (key === "" || t.installmentGroupId) continue;
		const groupKey = `${key}|${t.amountCents}`;
		groups.set(groupKey, [...(groups.get(groupKey) ?? []), t]);
	}
	const found: DuplicateCharge[] = [];
	for (const list of groups.values()) {
		const sorted = [...list].sort((a, b) =>
			a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1,
		);
		for (let i = 1; i < sorted.length; i++) {
			const first = sorted[i - 1] as WatchedSpend;
			const later = sorted[i] as WatchedSpend;
			const daysApart = daysBetween(first.date, later.date);
			if (daysApart > input.windowDays || later.date < input.since) continue;
			found.push({
				transactionId: later.id,
				firstTransactionId: first.id,
				merchant: later.merchant,
				amountCents: later.amountCents,
				firstDate: first.date,
				date: later.date,
				daysApart,
			});
		}
	}
	return found.sort((a, b) =>
		a.date < b.date ? -1 : a.date > b.date ? 1 : a.transactionId < b.transactionId ? -1 : 1,
	);
}

export interface BudgetThresholdHit {
	/** "total" ou o id da categoria. */
	scope: string;
	/** `over`: estourou o limite. `alert`: passou do percentual de aviso, mas ainda cabe. */
	level: "alert" | "over";
	limitCents: Cents;
	spentCents: Cents;
	/** Pode ser negativo quando estourou. */
	remainingCents: Cents;
	thresholdPercent: number;
}

/** Orçamentos que passaram do percentual de aviso (o das Preferências, em `passedThreshold`) ou estouraram. */
export function detectBudgetThresholds(input: {
	budgets: readonly { scope: string; limitCents: Cents; spentCents: Cents }[];
	thresholdPercent: number;
}): BudgetThresholdHit[] {
	const hits: BudgetThresholdHit[] = [];
	for (const b of input.budgets) {
		const status = budgetStatus({ limitCents: b.limitCents, spentCents: b.spentCents });
		const passed = passedThreshold({
			limitCents: b.limitCents,
			spentCents: b.spentCents,
			thresholdPercent: input.thresholdPercent,
		});
		if (!passed && !status.overBudget) continue;
		hits.push({
			scope: b.scope,
			level: status.overBudget ? "over" : "alert",
			limitCents: b.limitCents,
			spentCents: b.spentCents,
			remainingCents: status.remainingCents,
			thresholdPercent: input.thresholdPercent,
		});
	}
	return hits;
}
