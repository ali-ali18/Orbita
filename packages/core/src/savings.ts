import { addDays, addMonths, daysBetween, monthOf } from "./dates.ts";
import { knownServiceOf, subscriptionBrand } from "./known-services.ts";
import { merchantKey } from "./merchant.ts";
import { assertCents } from "./money.ts";
import {
	detectPriceIncreases,
	findMonthlyRuns,
	type HuntedCharge,
	type MonthlyRun,
	type RegisteredSubscription,
} from "./subscription-hunt.ts";
import type { Cents, LocalDate, MonthKey } from "./types.ts";

/*
 * Motor de oportunidades de economia ("onde dá para cortar"). Função pura: recebe o que as stores já têm e devolve
 * achados com a conta feita em centavos inteiros, a evidência (ids de lançamentos e de assinaturas) e a confiança.
 * Sem IA, sem relógio, sem banco. O texto do aviso e o agente que age em cima disto vêm depois: aqui só nasce número.
 *
 * Regra de honestidade: só se afirma o que os lançamentos mostram. "Assinatura sem uso aparente" NÃO existe aqui:
 * o app não sabe se o dono usa o serviço, e inventar isso seria chute.
 */

export const OPPORTUNITY_TYPES = [
	"duplicate_subscription",
	"price_increase",
	"category_above_average",
	"fees",
	"small_recurring",
	"installments_load",
	"projected_over",
	"invoice_unfunded",
] as const;
export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

export type SavingsConfidence = "high" | "medium" | "low";

/** Despesas que entram na análise (as mesmas que o Início soma): pendentes inclusive, apagadas nunca. */
export interface SavingsSpend {
	id: string;
	date: LocalDate;
	amountCents: Cents;
	/** `null` = sem categoria. */
	categoryId: string | null;
	/** Slug da categoria (para separar o essencial, como mercado e moradia, do que dá para cortar). */
	categorySlug?: string | null;
	/** Estabelecimento (ou descrição) como veio do banco. */
	merchant: string;
	/** Texto extra para achar a marca ("GOOGLE *YouTubeMusic" quando o nome é só "Google"). */
	brandText?: string;
	/** Parcela de compra parcelada: não é hábito de consumo, nem tarifa repetida. */
	installmentGroupId?: string | null;
}

export interface SavingsSubscription extends RegisteredSubscription {
	/** "Lembrar 1 dia antes" ligado (a ação de um toque "Cancelar lembrete" só vale com ele ligado). */
	remindDayBefore: boolean;
}

export interface SavingsInvoice {
	cardId: string;
	cardName: string;
	dueDate: LocalDate;
	/** O que ainda se deve nesta fatura (do ledger). */
	owedCents: Cents;
}

export interface SavingsInput {
	today: LocalDate;
	/** Despesas de, no mínimo, os 3 meses fechados anteriores e o mês corrente até hoje. */
	spends: readonly SavingsSpend[];
	/** Assinaturas (recorrências de despesa) ativas. */
	subscriptions: readonly SavingsSubscription[];
	/** Lançamentos que já nasceram de uma recorrência (o valor deles é o cadastrado, não mostra aumento). */
	postedIds: ReadonlySet<string>;
	/** Renda esperada do mês (fontes de renda); `null` = não cadastrada. */
	incomeCents: Cents | null;
	/** Orçamento total do mês; `null` = não definido. */
	totalBudgetCents: Cents | null;
	/** Gasto projetado do mês (engine `projectMonth`); `null` fora do mês corrente. */
	projectedCents: Cents | null;
	projectionLowConfidence: boolean;
	/** O que os parcelamentos vigentes comprometem no mês (engine `installmentStanding`) e os ids das parcelas. */
	installments: { committedCents: Cents; transactionIds: readonly string[]; groupCount: number };
	invoices: readonly SavingsInvoice[];
	/** Saldo somado das contas do banco; `null` quando nenhuma conta tem saldo lido (ausente não é zero). */
	balanceCents: Cents | null;
}

export interface Evidence {
	transactionIds: string[];
	subscriptionIds: string[];
}

interface Base<T extends OpportunityType, D> {
	/** Estável: identifica o achado entre execuções (para ignorar e para não avisar duas vezes). */
	key: string;
	type: T;
	evidence: Evidence;
	/** Quanto dá para economizar por mês, em centavos inteiros (0 quando o achado é um risco, não uma economia). */
	monthlySavingsCents: Cents;
	confidence: SavingsConfidence;
	/** Entra no total "dá para cortar"? Falso nos achados que se sobrepõem a outros (categoria, projeção, parcelas). */
	countsInTotal: boolean;
	detail: D;
}

export type DuplicateGroup = "music" | "ai" | "video" | "same";
export interface DuplicateService {
	name: string;
	amountCents: Cents;
	/** Assinatura cadastrada, quando é uma. */
	subscriptionId: string | null;
	/** Última cobrança vista. */
	transactionId: string | null;
}
export type FeeKind = "interest" | "iof" | "annuity" | "bank_fee";

export type SavingsOpportunity =
	| Base<"duplicate_subscription", { group: DuplicateGroup; services: DuplicateService[] }>
	| Base<
			"price_increase",
			{ subscriptionId: string; name: string; previousCents: Cents; newCents: Cents; increaseCents: Cents }
	  >
	| Base<
			"category_above_average",
			{
				categoryId: string;
				spentCents: Cents;
				averageCents: Cents;
				excessCents: Cents;
				percentAbove: number;
				monthsUsed: number;
				/** O limite que o dono recebe ao tocar em "Criar limite": a média, em reais inteiros. */
				suggestedLimitCents: Cents;
			}
	  >
	| Base<
			"fees",
			{ feeKind: FeeKind; totalCents: Cents; count: number; windowDays: number; monthlyCents: Cents }
	  >
	| Base<
			"small_recurring",
			{
				merchant: string;
				count: number;
				totalCents: Cents;
				averageCents: Cents;
				cutPercent: number;
				windowDays: number;
			}
	  >
	| Base<
			"installments_load",
			{
				committedCents: Cents;
				incomeCents: Cents;
				percent: number;
				thresholdPercent: number;
				groupCount: number;
			}
	  >
	| Base<
			"projected_over",
			{
				projectedCents: Cents;
				referenceCents: Cents;
				reference: "budget" | "income";
				excessCents: Cents;
			}
	  >
	| Base<
			"invoice_unfunded",
			{
				owedCents: Cents;
				balanceCents: Cents;
				shortfallCents: Cents;
				dueDate: LocalDate;
				cards: Array<{ cardId: string; cardName: string; owedCents: Cents; dueDate: LocalDate }>;
			}
	  >;

export interface SavingsResult {
	opportunities: SavingsOpportunity[];
	/** Soma só do que não se sobrepõe (`countsInTotal`): nunca conta duas vezes o mesmo corte. */
	totalMonthlySavingsCents: Cents;
}

// ------------------------------------------------------------------ constantes

/** Quantos meses fechados formam "a média". */
export const AVERAGE_MONTHS = 3;
/** A categoria precisa estar pelo menos isto acima da média (%) e isto em centavos para valer um aviso. */
export const CATEGORY_MIN_PERCENT_ABOVE = 20;
export const CATEGORY_MIN_EXCESS_CENTS = 5000;
/** Categorias que não são hábito de consumo: moradia (aluguel é fixo), as que só movem dinheiro e "Outros". */
export const CATEGORY_EXCLUDED_SLUGS: ReadonlySet<string> = new Set([
	"moradia",
	"transferencias",
	"investimentos",
	"fatura-cartao",
	"salario",
	// Catch-all: não é um hábito de consumo, então "acima da média" não quer dizer nada.
	"outros",
]);
/** Essencial: mercado, saúde e moradia não entram em "compras pequenas que somam". */
export const ESSENTIAL_SLUGS: ReadonlySet<string> = new Set(["mercado", "saude", "moradia"]);

/** Tarifas e juros: janela de 90 dias, dividida em 3 para ter o valor por mês. */
export const FEE_WINDOW_DAYS = 90;
export const FEE_MIN_TOTAL_CENTS = 500;

export const SMALL_WINDOW_DAYS = 30;
export const SMALL_MIN_COUNT = 5;
/** "Pequena": até R$ 60 cada. */
export const SMALL_MAX_EACH_CENTS = 6000;
/** Só avisa se a soma passa de R$ 100 no período. */
export const SMALL_MIN_TOTAL_CENTS = 10000;
/** A economia estimada é cortar um quarto das idas (decisão de produto, não dedução do extrato). */
export const SMALL_CUT_PERCENT = 25;

/** Parcelas acima disto da renda (%) pesam demais. */
export const INSTALLMENTS_HIGH_PERCENT = 30;
export const PROJECTED_MIN_EXCESS_CENTS = 5000;
/** Fatura que vence em até isto de dias entra em "a vencer". */
export const INVOICE_SOON_DAYS = 10;

const FEE_KIND_ORDER: readonly FeeKind[] = ["interest", "iof", "annuity", "bank_fee"];

// ------------------------------------------------------------------ taxas

const fold = (text: string): string => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");

/**
 * Que tipo de tarifa um texto de extrato é, ou `null`. Casa palavras inteiras e só as formas bancárias: "multa de
 * trânsito" e "tarifa de ônibus" não são tarifa bancária e ficam de fora.
 */
export function classifyFee(text: string | null | undefined): FeeKind | null {
	if (!text) return null;
	const t = ` ${fold(text).replace(/[^a-z0-9]+/g, " ")} `;
	if (
		/ (juros|encargos?|mora|rotativo) /.test(t) ||
		/ multa (por |de )?(atraso|mora|fatura|pagamento)/.test(t) ||
		/ (credito|cartao) rotativo /.test(t)
	) {
		return "interest";
	}
	if (/ iof /.test(t)) return "iof";
	if (/ anuidade /.test(t)) return "annuity";
	if (
		/ (tarifa|tarifas) (bancaria|banco|de manutencao|de conta|de servicos?|pacote|de cartao|de saque|de ted|de doc|de extrato)/.test(
			t,
		) ||
		/ (cesta|pacote) de servicos /.test(t) ||
		/ (taxa|tarifa) de manutencao /.test(t) ||
		/ manutencao de conta /.test(t)
	) {
		return "bank_fee";
	}
	return null;
}

// ------------------------------------------------------------------ assinaturas

const OVERLAP_GROUPS: ReadonlyArray<{
	group: Exclude<DuplicateGroup, "same">;
	brands: ReadonlySet<string>;
	min: number;
}> = [
	// YouTube e Amazon Prime ficam de fora de propósito: cada um junta vídeo, música e outras coisas.
	{ group: "music", brands: new Set(["spotify", "deezer", "applemusic", "tidal"]), min: 2 },
	{ group: "ai", brands: new Set(["chatgpt", "claude", "anthropic", "grok"]), min: 2 },
	// Dois streamings de vídeo é normal; três já merecem a pergunta.
	{
		group: "video",
		brands: new Set([
			"netflix",
			"disney",
			"disneyplus",
			"hbo",
			"hbomax",
			"globoplay",
			"paramount",
			"telecine",
		]),
		min: 3,
	},
];

interface Service extends DuplicateService {
	brand: string;
	registered: boolean;
}

function collectServices(input: SavingsInput): Service[] {
	const services: Service[] = [];
	const registeredBrands: string[] = [];
	for (const s of input.subscriptions) {
		const brand = subscriptionBrand(s.name);
		if (brand === "" || s.amountCents <= 0) continue;
		registeredBrands.push(brand);
		services.push({
			name: s.name,
			amountCents: s.amountCents,
			subscriptionId: s.id,
			transactionId: null,
			brand,
			registered: true,
		});
	}
	const charges: HuntedCharge[] = input.spends.map((t) => ({
		id: t.id,
		date: t.date,
		amountCents: t.amountCents,
		merchant: t.merchant,
		...(t.brandText ? { brandText: t.brandText } : {}),
	}));
	const runs: Array<MonthlyRun<HuntedCharge>> = findMonthlyRuns({
		charges,
		today: input.today,
		excludeIds: input.postedIds,
		minOccurrences: 3,
		minKnownOccurrences: 2,
	});
	for (const run of runs) {
		if (registeredBrands.includes(run.brand)) continue;
		const last = run.charges.at(-1) as HuntedCharge;
		services.push({
			name: knownServiceOf(last.brandText ?? last.merchant)?.short ?? last.merchant,
			amountCents: run.amountCents,
			subscriptionId: null,
			transactionId: last.id,
			brand: run.brand,
			registered: false,
		});
	}
	return services;
}

function duplicateSubscriptions(input: SavingsInput): SavingsOpportunity[] {
	const services = collectServices(input);
	const found: SavingsOpportunity[] = [];
	const used = new Set<Service>();
	const push = (group: DuplicateGroup, list: Service[], confidence: SavingsConfidence, keyPart: string) => {
		for (const s of list) used.add(s);
		const sorted = [...list].sort((a, b) => a.amountCents - b.amountCents || (a.name < b.name ? -1 : 1));
		found.push({
			key: `duplicate_subscription:${keyPart}`,
			type: "duplicate_subscription",
			evidence: {
				transactionIds: sorted.flatMap((s) => (s.transactionId ? [s.transactionId] : [])),
				subscriptionIds: sorted.flatMap((s) => (s.subscriptionId ? [s.subscriptionId] : [])),
			},
			// O corte garantido é o do mais barato: o dono escolhe qual manter, e nunca se promete mais que isso.
			monthlySavingsCents: (sorted[0] as Service).amountCents,
			confidence,
			countsInTotal: true,
			detail: {
				group,
				services: sorted.map((s) => ({
					name: s.name,
					amountCents: s.amountCents,
					subscriptionId: s.subscriptionId,
					transactionId: s.transactionId,
				})),
			},
		});
	};

	for (const { group, brands, min } of OVERLAP_GROUPS) {
		const list = services.filter((s) => brands.has(s.brand));
		// Marcas distintas: a mesma marca duas vezes é o caso "same", logo abaixo.
		if (new Set(list.map((s) => s.brand)).size < min) continue;
		const allRegistered = list.every((s) => s.registered);
		const confidence: SavingsConfidence = group === "video" ? "low" : allRegistered ? "high" : "medium";
		push(group, list, confidence, `${group}:${[...new Set(list.map((s) => s.brand))].sort().join("+")}`);
	}

	// A mesma marca cadastrada duas vezes (dois planos do mesmo serviço), só para serviços que o catálogo conhece.
	const byBrand = new Map<string, Service[]>();
	for (const s of services) {
		if (!s.registered || used.has(s) || knownServiceOf(s.name) === null) continue;
		byBrand.set(s.brand, [...(byBrand.get(s.brand) ?? []), s]);
	}
	for (const [brand, list] of byBrand) if (list.length >= 2) push("same", list, "medium", `same:${brand}`);
	return found;
}

function priceIncreases(input: SavingsInput): SavingsOpportunity[] {
	const charges: HuntedCharge[] = input.spends.map((t) => ({
		id: t.id,
		date: t.date,
		amountCents: t.amountCents,
		merchant: t.merchant,
		...(t.brandText ? { brandText: t.brandText } : {}),
	}));
	return detectPriceIncreases({
		subscriptions: input.subscriptions,
		charges,
		sinceDate: addDays(input.today, -45),
		excludeIds: input.postedIds,
	}).map(
		(f): SavingsOpportunity => ({
			key: `price_increase:${f.subscriptionId}:${f.newCents}`,
			type: "price_increase",
			evidence: { transactionIds: [f.transactionId], subscriptionIds: [f.subscriptionId] },
			monthlySavingsCents: f.increaseCents,
			confidence: "high",
			countsInTotal: true,
			detail: {
				subscriptionId: f.subscriptionId,
				name: f.name,
				previousCents: f.previousCents,
				newCents: f.newCents,
				increaseCents: f.increaseCents,
			},
		}),
	);
}

// ------------------------------------------------------------------ categoria

function categoriesAboveAverage(input: SavingsInput): SavingsOpportunity[] {
	const month = monthOf(input.today);
	const baseline: MonthKey[] = Array.from({ length: AVERAGE_MONTHS }, (_, i) => addMonths(month, -(i + 1)));
	// Mês fechado sem nenhum lançamento é "sem dados" (conta recém-aberta), não "gastei zero".
	const monthHasData = new Set<MonthKey>();
	const perCategory = new Map<string, Map<MonthKey, Cents>>();
	const current = new Map<string, SavingsSpend[]>();
	for (const t of input.spends) {
		assertCents(t.amountCents, "amountCents");
		const m = monthOf(t.date);
		if (baseline.includes(m)) monthHasData.add(m);
		if (t.categoryId === null || (t.categorySlug && CATEGORY_EXCLUDED_SLUGS.has(t.categorySlug))) continue;
		if (m === month) current.set(t.categoryId, [...(current.get(t.categoryId) ?? []), t]);
		else if (baseline.includes(m)) {
			const months = perCategory.get(t.categoryId) ?? new Map<MonthKey, Cents>();
			months.set(m, (months.get(m) ?? 0) + t.amountCents);
			perCategory.set(t.categoryId, months);
		}
	}
	const monthsUsed = baseline.filter((m) => monthHasData.has(m));
	if (monthsUsed.length < 2) return [];

	const found: SavingsOpportunity[] = [];
	for (const [categoryId, list] of current) {
		const months = perCategory.get(categoryId);
		// A categoria precisa ter gasto em pelo menos 2 dos meses de comparação: categoria nova não tem "média".
		if (!months || [...months.values()].filter((v) => v > 0).length < 2) continue;
		let total = 0;
		for (const m of monthsUsed) total += months.get(m) ?? 0;
		const averageCents = Math.floor(total / monthsUsed.length);
		const spentCents = list.reduce((sum, t) => sum + t.amountCents, 0);
		const excessCents = spentCents - averageCents;
		if (averageCents <= 0 || excessCents < CATEGORY_MIN_EXCESS_CENTS) continue;
		const percentAbove = Math.floor((excessCents * 100) / averageCents);
		if (percentAbove < CATEGORY_MIN_PERCENT_ABOVE) continue;
		const biggest = [...list].sort((a, b) => b.amountCents - a.amountCents || (a.id < b.id ? -1 : 1));
		found.push({
			key: `category_above_average:${categoryId}:${month}`,
			type: "category_above_average",
			evidence: { transactionIds: biggest.slice(0, 5).map((t) => t.id), subscriptionIds: [] },
			monthlySavingsCents: excessCents,
			confidence: monthsUsed.length === AVERAGE_MONTHS ? "high" : "medium",
			countsInTotal: false,
			detail: {
				categoryId,
				spentCents,
				averageCents,
				excessCents,
				percentAbove,
				monthsUsed: monthsUsed.length,
				suggestedLimitCents: Math.max(100, Math.round(averageCents / 100) * 100),
			},
		});
	}
	return found.sort((a, b) => b.monthlySavingsCents - a.monthlySavingsCents || (a.key < b.key ? -1 : 1));
}

// ------------------------------------------------------------------ taxas pagas

function feesPaid(input: SavingsInput): SavingsOpportunity[] {
	const from = addDays(input.today, -(FEE_WINDOW_DAYS - 1));
	const byKind = new Map<FeeKind, SavingsSpend[]>();
	for (const t of input.spends) {
		if (t.date < from || t.date > input.today || t.installmentGroupId) continue;
		const kind = classifyFee(t.merchant) ?? classifyFee(t.brandText);
		if (kind === null) continue;
		assertCents(t.amountCents, "amountCents");
		byKind.set(kind, [...(byKind.get(kind) ?? []), t]);
	}
	const found: SavingsOpportunity[] = [];
	for (const kind of FEE_KIND_ORDER) {
		const list = byKind.get(kind);
		if (!list) continue;
		const totalCents = list.reduce((sum, t) => sum + t.amountCents, 0);
		if (totalCents < FEE_MIN_TOTAL_CENTS) continue;
		// Anuidade cobrada de uma vez só é do ano todo: o mês é um doze avos. As demais, a média dos 3 meses da janela.
		const monthlyCents =
			kind === "annuity" && list.length === 1
				? Math.floor(totalCents / 12)
				: Math.floor(totalCents / (FEE_WINDOW_DAYS / 30));
		if (monthlyCents <= 0) continue;
		found.push({
			key: `fees:${kind}:${monthOf(input.today)}`,
			type: "fees",
			evidence: { transactionIds: list.map((t) => t.id).sort(), subscriptionIds: [] },
			monthlySavingsCents: monthlyCents,
			// Juros se evitam pagando em dia; IOF e tarifa dependem de como o dono usa a conta e o cartão.
			confidence: kind === "interest" ? "high" : "medium",
			countsInTotal: true,
			detail: { feeKind: kind, totalCents, count: list.length, windowDays: FEE_WINDOW_DAYS, monthlyCents },
		});
	}
	return found;
}

// ------------------------------------------------------------------ compras pequenas

function smallRecurring(input: SavingsInput, subscriptionBrands: ReadonlySet<string>): SavingsOpportunity[] {
	const from = addDays(input.today, -(SMALL_WINDOW_DAYS - 1));
	const groups = new Map<string, { label: string; list: SavingsSpend[] }>();
	for (const t of input.spends) {
		if (t.date < from || t.date > input.today || t.installmentGroupId) continue;
		if (t.amountCents > SMALL_MAX_EACH_CENTS) continue;
		if (t.categorySlug && ESSENTIAL_SLUGS.has(t.categorySlug)) continue;
		if (classifyFee(t.merchant) !== null) continue;
		assertCents(t.amountCents, "amountCents");
		const known = knownServiceOf(t.brandText ?? t.merchant);
		const key = known ? (known.brands[0] as string) : merchantKey(t.merchant, 2);
		if (key === "" || subscriptionBrands.has(subscriptionBrand(t.brandText ?? t.merchant))) continue;
		const label = known ? (known.short ?? known.name) : t.merchant;
		const group = groups.get(key) ?? { label, list: [] };
		group.list.push(t);
		groups.set(key, group);
	}
	const found: SavingsOpportunity[] = [];
	for (const [key, { label, list }] of groups) {
		if (list.length < SMALL_MIN_COUNT) continue;
		const totalCents = list.reduce((sum, t) => sum + t.amountCents, 0);
		if (totalCents < SMALL_MIN_TOTAL_CENTS) continue;
		// Mesmo dia e mesmo valor não é hábito, é cobrança repetida: o Vigia cuida disso.
		if (new Set(list.map((t) => t.date)).size < SMALL_MIN_COUNT - 1) continue;
		found.push({
			key: `small_recurring:${key}:${monthOf(input.today)}`,
			type: "small_recurring",
			evidence: { transactionIds: list.map((t) => t.id).sort(), subscriptionIds: [] },
			monthlySavingsCents: Math.floor((totalCents * SMALL_CUT_PERCENT) / 100),
			confidence: "low",
			countsInTotal: true,
			detail: {
				merchant: label,
				count: list.length,
				totalCents,
				averageCents: Math.floor(totalCents / list.length),
				cutPercent: SMALL_CUT_PERCENT,
				windowDays: SMALL_WINDOW_DAYS,
			},
		});
	}
	return found.sort((a, b) => b.monthlySavingsCents - a.monthlySavingsCents || (a.key < b.key ? -1 : 1));
}

// ------------------------------------------------------------------ renda, projeção e fatura

function installmentsLoad(input: SavingsInput): SavingsOpportunity[] {
	const { committedCents, groupCount, transactionIds } = input.installments;
	const income = input.incomeCents;
	if (income === null || income <= 0 || committedCents <= 0) return [];
	assertCents(committedCents, "committedCents");
	if (committedCents * 100 <= income * INSTALLMENTS_HIGH_PERCENT) return [];
	const relief = committedCents - Math.floor((income * INSTALLMENTS_HIGH_PERCENT) / 100);
	return [
		{
			key: `installments_load:${monthOf(input.today)}`,
			type: "installments_load",
			evidence: { transactionIds: [...transactionIds], subscriptionIds: [] },
			// O alívio que viria de voltar ao limite: não se cancela parcela, então não entra no total.
			monthlySavingsCents: relief,
			confidence: "medium",
			countsInTotal: false,
			detail: {
				committedCents,
				incomeCents: income,
				percent: Math.floor((committedCents * 100) / income),
				thresholdPercent: INSTALLMENTS_HIGH_PERCENT,
				groupCount,
			},
		},
	];
}

function projectedOver(input: SavingsInput): SavingsOpportunity[] {
	const { projectedCents } = input;
	if (projectedCents === null) return [];
	const limits: Array<{ cents: Cents; reference: "budget" | "income" }> = [];
	if (input.totalBudgetCents !== null && input.totalBudgetCents > 0) {
		limits.push({ cents: input.totalBudgetCents, reference: "budget" });
	}
	if (input.incomeCents !== null && input.incomeCents > 0) {
		limits.push({ cents: input.incomeCents, reference: "income" });
	}
	// O menor dos dois é o que aperta primeiro.
	const ref = limits.sort((a, b) => a.cents - b.cents)[0];
	if (!ref) return [];
	const excessCents = projectedCents - ref.cents;
	if (excessCents < PROJECTED_MIN_EXCESS_CENTS) return [];
	return [
		{
			key: `projected_over:${monthOf(input.today)}:${ref.reference}`,
			type: "projected_over",
			evidence: { transactionIds: [], subscriptionIds: [] },
			monthlySavingsCents: excessCents,
			confidence: input.projectionLowConfidence ? "low" : "medium",
			countsInTotal: false,
			detail: { projectedCents, referenceCents: ref.cents, reference: ref.reference, excessCents },
		},
	];
}

function invoiceUnfunded(input: SavingsInput): SavingsOpportunity[] {
	if (input.balanceCents === null) return [];
	const soon = input.invoices
		.filter(
			(i) =>
				i.owedCents > 0 &&
				i.dueDate >= input.today &&
				daysBetween(input.today, i.dueDate) <= INVOICE_SOON_DAYS,
		)
		.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.cardId < b.cardId ? -1 : 1));
	if (soon.length === 0) return [];
	const owedCents = soon.reduce((sum, i) => sum + i.owedCents, 0);
	const shortfallCents = owedCents - input.balanceCents;
	if (shortfallCents <= 0) return [];
	const first = soon[0] as SavingsInvoice;
	return [
		{
			key: `invoice_unfunded:${first.dueDate}`,
			type: "invoice_unfunded",
			evidence: { transactionIds: [], subscriptionIds: [] },
			// Risco de juros, não economia: não se promete valor nenhum.
			monthlySavingsCents: 0,
			confidence: "high",
			countsInTotal: false,
			detail: {
				owedCents,
				balanceCents: input.balanceCents,
				shortfallCents,
				dueDate: first.dueDate,
				cards: soon.map((i) => ({
					cardId: i.cardId,
					cardName: i.cardName,
					owedCents: i.owedCents,
					dueDate: i.dueDate,
				})),
			},
		},
	];
}

// ------------------------------------------------------------------ o motor

/** O resultado sem os achados que o dono ignorou (o total é refeito, sem contar o que saiu). */
export function withoutKeys(result: SavingsResult, ignored: ReadonlySet<string>): SavingsResult {
	if (ignored.size === 0) return result;
	const opportunities = result.opportunities.filter((o) => !ignored.has(o.key));
	return {
		opportunities,
		totalMonthlySavingsCents: opportunities.reduce(
			(sum, o) => (o.countsInTotal ? sum + o.monthlySavingsCents : sum),
			0,
		),
	};
}

/**
 * Os cortes que somam no total vêm primeiro, do maior para o menor; depois os que só dão contexto (categoria acima da
 * média, parcelas, projeção, fatura sem saldo), também do maior para o menor; o desempate é pela chave.
 */
const byImpact = (a: SavingsOpportunity, b: SavingsOpportunity): number =>
	Number(b.countsInTotal) - Number(a.countsInTotal) ||
	b.monthlySavingsCents - a.monthlySavingsCents ||
	(a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

export function findSavingsOpportunities(input: SavingsInput): SavingsResult {
	for (const s of input.subscriptions) assertCents(s.amountCents, "amountCents");
	const registeredBrands = new Set(
		input.subscriptions.map((s) => subscriptionBrand(s.name)).filter((b) => b !== ""),
	);
	const services = collectServices(input);
	for (const s of services) registeredBrands.add(s.brand);

	const opportunities = [
		...duplicateSubscriptions(input),
		...priceIncreases(input),
		...categoriesAboveAverage(input),
		...feesPaid(input),
		...smallRecurring(input, registeredBrands),
		...installmentsLoad(input),
		...projectedOver(input),
		...invoiceUnfunded(input),
	].sort(byImpact);
	const total = opportunities.reduce((sum, o) => (o.countsInTotal ? sum + o.monthlySavingsCents : sum), 0);
	return { opportunities, totalMonthlySavingsCents: total };
}
