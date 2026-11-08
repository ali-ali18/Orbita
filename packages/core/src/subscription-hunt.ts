import { daysBetween } from "./dates.ts";
import { medianCents, merchantKey } from "./merchant.ts";
import { assertCents } from "./money.ts";
import type { Cents, LocalDate } from "./types.ts";

/*
 * Detectores do Caça-assinatura: cobrança que se repete todo mês e ainda não está nas Assinaturas, e assinatura
 * registrada que ficou mais cara. Funções puras e sem IA.
 */

export interface HuntedCharge {
	id: string;
	date: LocalDate;
	amountCents: Cents;
	/** Estabelecimento (ou descrição) como veio do banco. */
	merchant: string;
}

/** Quantas cobranças seguidas formam um padrão. */
export const RECURRING_MIN_OCCURRENCES = 3;
/** Intervalo aceito entre duas cobranças do mesmo serviço (um "mês", com folga de feriado e fim de semana). */
export const RECURRING_MIN_GAP_DAYS = 25;
export const RECURRING_MAX_GAP_DAYS = 35;
/** Valores "parecidos": até 10 % da mediana (conta de 44,90 que vira 45,50 ainda é a mesma assinatura). */
export const SIMILAR_AMOUNT_PERCENT = 10;
/** A última cobrança não pode ser mais velha que isto, senão a assinatura já acabou. */
export const RECURRING_STALE_DAYS = 45;

export interface RecurringCandidate {
	merchant: string;
	/** Mediana dos valores do padrão. */
	amountCents: Cents;
	occurrences: number;
	firstDate: LocalDate;
	lastDate: LocalDate;
	lastTransactionId: string;
}

const similar = (amount: Cents, median: Cents): boolean =>
	Math.abs(amount - median) * 100 <= median * SIMILAR_AMOUNT_PERCENT;

/**
 * Cobranças que se repetem todo mês e ainda não são uma assinatura cadastrada: o mesmo estabelecimento, valor
 * parecido, `RECURRING_MIN_OCCURRENCES` ou mais cobranças seguidas com cerca de um mês entre elas, a última ainda
 * recente. Dois planos no mesmo cartão (valores diferentes) são padrões diferentes.
 *
 * `registeredNames` são os nomes das assinaturas já cadastradas (comparados pela marca) e `excludeIds` os lançamentos
 * que já nasceram de uma recorrência.
 */
export function detectRecurringCharges(input: {
	charges: readonly HuntedCharge[];
	registeredNames: readonly string[];
	excludeIds?: ReadonlySet<string>;
	today: LocalDate;
}): RecurringCandidate[] {
	const registered = new Set(input.registeredNames.map((n) => merchantKey(n, 1)).filter((k) => k !== ""));
	const byBrand = new Map<string, HuntedCharge[]>();
	for (const c of input.charges) {
		assertCents(c.amountCents, "amountCents");
		if (input.excludeIds?.has(c.id)) continue;
		const brand = merchantKey(c.merchant, 1);
		if (brand === "" || registered.has(brand)) continue;
		byBrand.set(brand, [...(byBrand.get(brand) ?? []), c]);
	}

	const found: RecurringCandidate[] = [];
	for (const list of byBrand.values()) {
		const sorted = [...list].sort((a, b) =>
			a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1,
		);
		// A sequência mais recente: anda de trás para frente enquanto o intervalo e o valor batem.
		const last = sorted.at(-1) as HuntedCharge;
		if (daysBetween(last.date, input.today) > RECURRING_STALE_DAYS) continue;
		const run: HuntedCharge[] = [last];
		for (let i = sorted.length - 2; i >= 0; i--) {
			const older = sorted[i] as HuntedCharge;
			const gap = daysBetween(older.date, (run[0] as HuntedCharge).date);
			if (gap < RECURRING_MIN_GAP_DAYS || gap > RECURRING_MAX_GAP_DAYS) break;
			const median = medianCents([...run, older].map((c) => c.amountCents));
			if (![...run, older].every((c) => similar(c.amountCents, median))) break;
			run.unshift(older);
		}
		if (run.length < RECURRING_MIN_OCCURRENCES) continue;
		found.push({
			merchant: last.merchant,
			amountCents: medianCents(run.map((c) => c.amountCents)),
			occurrences: run.length,
			firstDate: (run[0] as HuntedCharge).date,
			lastDate: last.date,
			lastTransactionId: last.id,
		});
	}
	return found.sort((a, b) =>
		a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : a.merchant < b.merchant ? -1 : 1,
	);
}

export interface RegisteredSubscription {
	id: string;
	name: string;
	amountCents: Cents;
}

export interface PriceIncrease {
	subscriptionId: string;
	name: string;
	/** O valor cadastrado. */
	previousCents: Cents;
	/** A cobrança mais recente do serviço. */
	newCents: Cents;
	increaseCents: Cents;
	transactionId: string;
	date: LocalDate;
}

/** Aumento mínimo que vale um aviso, em % do valor cadastrado (centavos de arredondamento não são aumento). */
export const PRICE_INCREASE_MIN_PERCENT = 3;

/**
 * Assinatura que ficou mais cara: a cobrança mais recente do serviço (casada pela marca do nome) passou do valor
 * cadastrado em pelo menos `PRICE_INCREASE_MIN_PERCENT` %. Só olha cobranças em `sinceDate` ou depois, para não
 * confundir com um preço antigo.
 */
export function detectPriceIncreases(input: {
	subscriptions: readonly RegisteredSubscription[];
	charges: readonly HuntedCharge[];
	sinceDate: LocalDate;
	/** Lançamentos que nasceram da própria recorrência já têm o valor cadastrado; os de fora é que mostram o aumento. */
	excludeIds?: ReadonlySet<string>;
}): PriceIncrease[] {
	const found: PriceIncrease[] = [];
	for (const sub of input.subscriptions) {
		assertCents(sub.amountCents, "amountCents");
		const brand = merchantKey(sub.name, 1);
		if (brand === "" || sub.amountCents <= 0) continue;
		const recent = input.charges
			.filter(
				(c) =>
					c.date >= input.sinceDate && !input.excludeIds?.has(c.id) && merchantKey(c.merchant, 1) === brand,
			)
			.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));
		const latest = recent[0];
		if (!latest) continue;
		const increase = latest.amountCents - sub.amountCents;
		if (increase <= 0 || increase * 100 < sub.amountCents * PRICE_INCREASE_MIN_PERCENT) continue;
		found.push({
			subscriptionId: sub.id,
			name: sub.name,
			previousCents: sub.amountCents,
			newCents: latest.amountCents,
			increaseCents: increase,
			transactionId: latest.id,
			date: latest.date,
		});
	}
	return found;
}
