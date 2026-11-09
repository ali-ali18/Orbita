import { daysBetween } from "./dates.ts";
import { isGooglePlayApp, sameSubscriptionBrand, subscriptionBrand } from "./known-services.ts";
import { medianCents } from "./merchant.ts";
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
	/**
	 * Texto usado só para achar a marca, quando o `merchant` sozinho não basta: o Pluggy devolve "Google" no nome e a
	 * descrição diz "GOOGLE *YouTubeMusic". Padrão: o próprio `merchant`.
	 */
	brandText?: string;
}

/** Quantas cobranças seguidas formam um padrão. */
export const RECURRING_MIN_OCCURRENCES = 3;
/** Intervalo aceito entre duas cobranças do mesmo serviço (um "mês", com folga de feriado e fim de semana). */
export const RECURRING_MIN_GAP_DAYS = 24;
export const RECURRING_MAX_GAP_DAYS = 37;
/** Com 3 cobranças ou mais, o maior e o menor intervalo não passam disto (compra solta que cai perto não é assinatura). */
export const RECURRING_MAX_GAP_SPREAD_DAYS = 9;
/** Cobranças iguais com até isto de diferença são a mesma (estorno e nova tentativa, duplicidade do banco). */
export const DUPLICATE_WINDOW_DAYS = 3;
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

/** Uma sequência mensal achada por `findMonthlyRuns`: as cobranças em ordem de data e a mediana do valor. */
export interface MonthlyRun<C extends HuntedCharge = HuntedCharge> {
	/** A marca (chave de agrupamento). */
	brand: string;
	charges: C[];
	amountCents: Cents;
}

/**
 * O coração do Caça-assinatura e da análise do histórico: agrupa as cobranças pela marca e, em cada grupo, anda da
 * mais recente para a mais antiga enquanto o intervalo é de cerca de um mês e o valor é parecido. Devolve as sequências
 * com `minOccurrences` ou mais cobranças (`minKnownOccurrences` para as marcas em `knownBrands`, que dispensam uma
 * cobrança: Netflix com 2 meses já é assinatura). A última cobrança não pode ser mais velha que `RECURRING_STALE_DAYS`.
 *
 * `brandOf` decide quem é "o mesmo serviço" (padrão: a primeira palavra do estabelecimento). Marcas em `skipBrands`
 * e cobranças em `excludeIds` ficam de fora. Não filtra por tipo de lançamento: quem chama passa só o que quer olhar.
 */
export function findMonthlyRuns<C extends HuntedCharge>(input: {
	charges: readonly C[];
	today: LocalDate;
	brandOf?: (merchant: string) => string;
	minOccurrences?: number;
	minKnownOccurrences?: number;
	knownBrands?: ReadonlySet<string>;
	skipBrands?: ReadonlySet<string>;
	excludeIds?: ReadonlySet<string>;
}): Array<MonthlyRun<C>> {
	const brandOf = input.brandOf ?? subscriptionBrand;
	const min = input.minOccurrences ?? RECURRING_MIN_OCCURRENCES;
	const minKnown = input.minKnownOccurrences ?? min;
	const byBrand = new Map<string, C[]>();
	for (const c of input.charges) {
		assertCents(c.amountCents, "amountCents");
		if (input.excludeIds?.has(c.id)) continue;
		const brand = brandOf(c.brandText ?? c.merchant);
		if (brand === "" || input.skipBrands?.has(brand)) continue;
		byBrand.set(brand, [...(byBrand.get(brand) ?? []), c]);
	}

	const found: Array<MonthlyRun<C>> = [];
	for (const [brand, list] of byBrand) {
		// Marca conhecida ou app do Google Play (Pierre, F1 TV…): duas cobranças mensais bastam.
		const need =
			input.knownBrands?.has(brand) || list.some((c) => isGooglePlayApp(c.brandText ?? c.merchant))
				? minKnown
				: min;
		// Uma marca pode ter planos diferentes (Google One e YouTube Music, ou dois planos): cada faixa de valor é
		// uma sequência à parte, senão uma cobrança de outro valor no meio do mês quebra a sequência inteira.
		for (const cluster of clusterByAmount(list)) {
			const run = latestRun(cluster, input.today);
			if (run.length < need) continue;
			found.push({ brand, charges: run, amountCents: medianCents(run.map((c) => c.amountCents)) });
		}
	}
	return found.sort((a, b) =>
		a.brand < b.brand ? -1 : a.brand > b.brand ? 1 : a.amountCents - b.amountCents,
	);
}

/** Agrupa por faixa de valor: uma faixa começa no menor valor e vai até esse valor + `SIMILAR_AMOUNT_PERCENT` %. */
function clusterByAmount<C extends HuntedCharge>(list: readonly C[]): C[][] {
	const sorted = [...list].sort((a, b) => a.amountCents - b.amountCents);
	const clusters: C[][] = [];
	for (const c of sorted) {
		const current = clusters.at(-1);
		const floor = current?.[0]?.amountCents ?? 0;
		if (current && (c.amountCents - floor) * 100 <= floor * SIMILAR_AMOUNT_PERCENT) current.push(c);
		else clusters.push([c]);
	}
	return clusters;
}

/** A sequência mais recente do grupo: anda de trás para frente enquanto o intervalo e o valor batem. */
function latestRun<C extends HuntedCharge>(list: readonly C[], today: LocalDate): C[] {
	const sorted = [...list].sort((a, b) =>
		a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1,
	);
	// Duplicidade: mesmo valor em até `DUPLICATE_WINDOW_DAYS` dias conta uma vez só (fica a primeira).
	const charges = sorted.filter((c, i) => {
		const prev = sorted[i - 1];
		return !(
			prev &&
			prev.amountCents === c.amountCents &&
			daysBetween(prev.date, c.date) <= DUPLICATE_WINDOW_DAYS
		);
	});
	const last = charges.at(-1);
	if (!last || daysBetween(last.date, today) > RECURRING_STALE_DAYS) return [];
	const run: C[] = [last];
	for (let i = charges.length - 2; i >= 0; i--) {
		const older = charges[i] as C;
		const gap = daysBetween(older.date, (run[0] as C).date);
		if (gap < RECURRING_MIN_GAP_DAYS || gap > RECURRING_MAX_GAP_DAYS) break;
		const median = medianCents([...run, older].map((c) => c.amountCents));
		if (![...run, older].every((c) => similar(c.amountCents, median))) break;
		run.unshift(older);
	}
	if (run.length >= 3) {
		const gaps = run.slice(1).map((c, i) => daysBetween((run[i] as C).date, c.date));
		// Intervalos irregulares: tira as mais antigas até a sequência ficar regular (ou curta demais).
		while (run.length >= 3 && Math.max(...gaps) - Math.min(...gaps) > RECURRING_MAX_GAP_SPREAD_DAYS) {
			run.shift();
			gaps.shift();
		}
	}
	return run;
}

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
	const registered = input.registeredNames.map((n) => subscriptionBrand(n)).filter((k) => k !== "");
	const runs = findMonthlyRuns({
		charges: input.charges,
		today: input.today,
		...(input.excludeIds ? { excludeIds: input.excludeIds } : {}),
	}).filter((r) => !registered.some((b) => sameSubscriptionBrand(b, r.brand)));
	const found: RecurringCandidate[] = runs.map((r) => {
		const first = r.charges[0] as HuntedCharge;
		const last = r.charges.at(-1) as HuntedCharge;
		return {
			merchant: last.merchant,
			amountCents: r.amountCents,
			occurrences: r.charges.length,
			firstDate: first.date,
			lastDate: last.date,
			lastTransactionId: last.id,
		};
	});
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
		const brand = subscriptionBrand(sub.name);
		if (brand === "" || sub.amountCents <= 0) continue;
		const recent = input.charges
			.filter(
				(c) =>
					c.date >= input.sinceDate &&
					!input.excludeIds?.has(c.id) &&
					sameSubscriptionBrand(subscriptionBrand(c.brandText ?? c.merchant), brand),
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
