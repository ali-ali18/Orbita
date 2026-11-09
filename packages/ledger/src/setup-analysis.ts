import {
	addMonths,
	type Cents,
	findMonthlyRuns,
	type HuntedCharge,
	KNOWN_SUBSCRIPTION_BRANDS,
	knownServiceOf,
	type LocalDate,
	medianCents,
	monthOf,
	parseLocalDate,
	sameSubscriptionBrand,
	subscriptionBrand,
} from "@orbita/core";
import {
	derivePattern,
	normalizeMerchantName,
	pickCategoryRule,
	SETUP_LOOKBACK_MONTHS,
	SETUP_MIN_MONTHS,
	type SetupAnalysis,
	type SetupIncome,
	type SetupMerchantGroup,
	type SetupRecurring,
} from "@orbita/shared";

/*
 * Análise do histórico para "Configurar com a Órbita". Função PURA (sem banco, sem relógio): recebe os lançamentos já
 * lidos e devolve o que se repete, o que está sem categoria e um palpite de salário. Valor, dia e data nascem AQUI;
 * a IA só dá nome e categoria, e o servidor confere cada número da proposta contra esta análise.
 */

export interface SetupTransaction {
	id: string;
	/** Só despesa e receita entram na análise. */
	kind: "expense" | "income";
	date: LocalDate;
	amountCents: Cents;
	description: string;
	merchantName: string | null;
	categoryId: string | null;
	accountId: string | null;
	cardId: string | null;
	/** Parcela de compra parcelada: nunca é assinatura. */
	installment: boolean;
}

export interface SetupAnalysisInput {
	transactions: readonly SetupTransaction[];
	today: LocalDate;
	/** Nomes das assinaturas (recorrências de despesa) já cadastradas. */
	registeredNames: readonly string[];
	hasIncome: boolean;
	categories: ReadonlyArray<{ id: string; slug: string }>;
	/** Regras de categoria que o dono já tem. */
	rules: ReadonlyArray<{ pattern: string; categoryId: string }>;
	/** Lançamentos que nasceram de uma recorrência cadastrada (não contam como cobrança nova). */
	recurringTransactionIds?: ReadonlySet<string>;
}

/** Quantos itens de cada lista a análise devolve (o dono revisa cada um: mais que isso é ruído). */
export const SETUP_MAX_RECURRING = 30;
export const SETUP_MAX_CANDIDATES = 25;
/** Um estabelecimento só vira candidato a regra com pelo menos isto de lançamentos. */
export const SETUP_MIN_GROUP_COUNT = 2;
/** Salário: pelo menos isto de créditos mensais seguidos. */
export const SETUP_INCOME_MIN_OCCURRENCES = 3;

interface Charge extends HuntedCharge {
	accountId: string | null;
	cardId: string | null;
	categoryId: string | null;
}

/** O texto do estabelecimento: o nome que o banco deu, senão a descrição. */
const textOf = (t: SetupTransaction) => t.merchantName ?? t.description;

/** Marca de assinatura de um texto já limpo: o serviço ("YouTube", "Google One") ou a primeira palavra do nome. */
const brandOf = (text: string) => subscriptionBrand(normalizeMerchantName(text) || text);

/**
 * O texto de onde sai a marca: nome do estabelecimento e descrição juntos, cada um sem prefixo de banco. O Pluggy
 * costuma dar só "Google" no nome e deixar "GOOGLE *YouTubeMusic" na descrição.
 */
const brandTextOf = (t: SetupTransaction): string => {
	const parts = [t.merchantName, t.description]
		.map((x) => normalizeMerchantName(x))
		.filter((x, i, all) => x !== "" && all.indexOf(x) === i);
	return parts.length > 0 ? parts.join(" ") : textOf(t);
};

/** O valor mais frequente (empate: o que aparece primeiro). */
function mostCommon<T extends string>(values: readonly (T | null)[]): T | null {
	const counts = new Map<T, number>();
	for (const v of values) if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1);
	let best: T | null = null;
	let bestCount = 0;
	for (const [v, n] of counts) {
		if (n > bestCount) {
			best = v;
			bestCount = n;
		}
	}
	return best;
}

/** A conta ou o cartão em que a maior parte das cobranças caiu. */
function whereOf(charges: readonly Charge[]): { accountId: string | null; cardId: string | null } {
	const pick = mostCommon(
		charges.map((c) => (c.cardId ? `card:${c.cardId}` : c.accountId ? `acc:${c.accountId}` : null)),
	);
	if (pick === null) return { accountId: null, cardId: null };
	return pick.startsWith("card:")
		? { accountId: null, cardId: pick.slice(5) }
		: { accountId: pick.slice(4), cardId: null };
}

const dayOfMonthOf = (dates: readonly LocalDate[]): number =>
	medianCents(dates.map((d) => parseLocalDate(d).day));

export function analyzeHistory(input: SetupAnalysisInput): SetupAnalysis {
	const { today } = input;
	const from: LocalDate = `${addMonths(monthOf(today), -(SETUP_LOOKBACK_MONTHS - 1))}-01`;
	const txs = input.transactions.filter((t) => t.date >= from && t.date <= today);
	const outrosIds = new Set(input.categories.filter((c) => c.slug === "outros").map((c) => c.id));
	const categoryBySlug = new Map(input.categories.map((c) => [c.slug, c.id]));
	const isOutros = (id: string | null) => id === null || outrosIds.has(id);
	const registered = input.registeredNames.map((n) => brandOf(n)).filter((k) => k !== "");
	const isRegistered = (brand: string) => registered.some((b) => sameSubscriptionBrand(b, brand));
	const months = new Set(txs.map((t) => monthOf(t.date)));

	const toCharge = (t: SetupTransaction, withBrandText = false): Charge => ({
		id: t.id,
		date: t.date,
		amountCents: t.amountCents,
		merchant: textOf(t),
		...(withBrandText ? { brandText: brandTextOf(t) } : {}),
		accountId: t.accountId,
		cardId: t.cardId,
		categoryId: t.categoryId,
	});

	// ---- cobranças mensais (despesas que não são parcela)
	const expenses = txs.filter((t) => t.kind === "expense");
	const runs = findMonthlyRuns({
		charges: expenses.filter((t) => !t.installment).map((t) => toCharge(t, true)),
		today,
		brandOf: subscriptionBrand,
		minKnownOccurrences: 2,
		knownBrands: KNOWN_SUBSCRIPTION_BRANDS,
		...(input.recurringTransactionIds ? { excludeIds: input.recurringTransactionIds } : {}),
	});
	const runsPerBrand = new Map<string, number>();
	for (const run of runs) runsPerBrand.set(run.brand, (runsPerBrand.get(run.brand) ?? 0) + 1);
	const recurring: SetupRecurring[] = runs.map((run) => {
		const first = run.charges[0] as Charge;
		const last = run.charges.at(-1) as Charge;
		const known = knownServiceOf(last.brandText ?? last.merchant);
		const fromRule = pickCategoryRule(input.rules, last.merchant)?.categoryId ?? null;
		const fromBank = mostCommon(run.charges.map((c) => (isOutros(c.categoryId) ? null : c.categoryId)));
		const fromCatalog = known ? (categoryBySlug.get(known.categorySlug) ?? null) : null;
		return {
			// Planos diferentes da mesma marca (valores em faixas distintas) ganham o valor na chave.
			key:
				(runsPerBrand.get(run.brand) ?? 0) > 1 ? `rec:${run.brand}:${run.amountCents}` : `rec:${run.brand}`,
			merchant: last.merchant,
			amountCents: run.amountCents,
			lastAmountCents: last.amountCents,
			averageAmountCents: Math.round(
				run.charges.reduce((sum, c) => sum + c.amountCents, 0) / run.charges.length,
			),
			dayOfMonth: dayOfMonthOf(run.charges.map((c) => c.date)),
			occurrences: run.charges.length,
			firstDate: first.date,
			lastDate: last.date,
			startDate: `${addMonths(monthOf(last.date), 1)}-01`,
			...whereOf(run.charges),
			registered: isRegistered(run.brand),
			knownService: known?.name ?? null,
			categoryId: fromRule ?? fromBank ?? fromCatalog,
		};
	});
	recurring.sort(
		(a, b) =>
			Number(a.registered) - Number(b.registered) ||
			b.amountCents - a.amountCents ||
			(a.key < b.key ? -1 : 1),
	);

	// ---- sem categoria (ou em "Outros"): candidatos a regra
	const groups = new Map<string, SetupTransaction[]>();
	for (const t of expenses) {
		if (!isOutros(t.categoryId)) continue;
		const pattern = derivePattern(t.merchantName, t.description);
		if (pattern === null || pickCategoryRule(input.rules, pattern) !== null) continue;
		groups.set(pattern, [...(groups.get(pattern) ?? []), t]);
	}
	const categoryCandidates: SetupMerchantGroup[] = [...groups.entries()]
		.filter(([, list]) => list.length >= SETUP_MIN_GROUP_COUNT)
		.map(([pattern, list]) => {
			const latest = list.reduce((a, b) => (b.date > a.date ? b : a));
			const known = knownServiceOf(pattern);
			return {
				key: `cat:${pattern}`,
				pattern,
				merchant: mostCommon(list.map((t) => textOf(t))) ?? textOf(latest),
				count: list.length,
				totalCents: list.reduce((sum, t) => sum + t.amountCents, 0),
				lastDate: latest.date,
				categoryId: known ? (categoryBySlug.get(known.categorySlug) ?? null) : null,
			};
		})
		.sort((a, b) => b.totalCents - a.totalCents || (a.key < b.key ? -1 : 1))
		.slice(0, SETUP_MAX_CANDIDATES);

	// ---- salário: crédito mensal parecido, sempre do mesmo pagador (só se ainda não há renda cadastrada)
	let income: SetupIncome | null = null;
	if (!input.hasIncome) {
		const credits = txs.filter((t) => t.kind === "income").map((t) => toCharge(t));
		const payerOf = (text: string) => (derivePattern(text) ?? "").split(" ").slice(0, 2).join(" ");
		const best = findMonthlyRuns({
			charges: credits,
			today,
			brandOf: payerOf,
			minOccurrences: SETUP_INCOME_MIN_OCCURRENCES,
		}).sort((a, b) => b.amountCents - a.amountCents || (a.brand < b.brand ? -1 : 1))[0];
		if (best) {
			const last = best.charges.at(-1) as Charge;
			income = {
				key: `inc:${best.brand}`,
				payer: last.merchant,
				amountCents: best.amountCents,
				payday: dayOfMonthOf(best.charges.map((c) => c.date)),
				occurrences: best.charges.length,
				lastDate: last.date,
				accountId: whereOf(best.charges).accountId,
			};
		}
	}

	return {
		from,
		to: today,
		monthsOfHistory: months.size,
		limitedHistory: months.size < SETUP_MIN_MONTHS,
		transactionCount: txs.length,
		hasIncome: input.hasIncome,
		recurring: recurring.slice(0, SETUP_MAX_RECURRING),
		categoryCandidates,
		income,
	};
}
