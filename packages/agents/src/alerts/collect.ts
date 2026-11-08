import {
	addDays,
	addMonths,
	closeMonth,
	detectBudgetThresholds,
	detectDuplicateCharges,
	detectPriceIncreases,
	detectRecurringCharges,
	detectUnusualSpending,
	type GoalFacts,
	goalsBehindPace,
	type HuntedCharge,
	type LocalDate,
	type MonthKey,
	type MonthReport,
	merchantKey,
	monthOf,
	type RegisteredSubscription,
	suggestSaving,
	type WatchedSpend,
} from "@orbita/core";
import {
	type AgentSettingsOf,
	type AlertKind,
	agentSettingsSchemas,
	BUILTIN_AGENTS,
	type BuiltinAgentKey,
	type GoalsListResponse,
	type MonthSummaryResponse,
} from "@orbita/shared";
import {
	type AlertText,
	budgetThresholdText,
	duplicateChargeText,
	goalBehindText,
	monthClosingText,
	newSubscriptionText,
	priceIncreaseText,
	savingSuggestionText,
	unusualSpendingText,
} from "./text.ts";

/*
 * Do achado ao aviso. Cada agente da casa tem uma função que pergunta os dados à porta, chama os detectores do
 * engine (`@orbita/core`) e monta o aviso com o texto-modelo. NENHUMA IA aqui: o resultado é o mesmo com ou sem
 * chave da Anthropic. A IA só reescreve o texto depois (`wording.ts`), se estiver ligada e dentro do limite.
 */

/** O que um aviso precisa para ser gravado (o mesmo formato de `AlertDraft` do `@orbita/db`). */
export interface AlertCandidate {
	kind: AlertKind;
	/** Identifica o achado: o par (agente, chave) é único, então o mesmo achado nunca vira dois avisos. */
	dedupeKey: string;
	title: string;
	body: string;
	/** Números do achado, em centavos inteiros. */
	data: Record<string, unknown>;
	transactionId: string | null;
	/** O texto já foi escrito pela IA (agente do dono). */
	wordedByAi?: boolean;
}

/** Os dados que os agentes leem; o worker implementa em cima das stores e do `@orbita/ledger`. */
export interface FindingsPort {
	/** Hoje no fuso do dono. */
	today: LocalDate;
	/** Nome da categoria (ou o que houver); a porta já tem o catálogo carregado. */
	categoryName(id: string): string;
	/** Despesas (não apagadas, pendentes inclusive) com data no intervalo, inclusive. */
	expenses(range: { from: LocalDate; to: LocalDate }): Promise<WatchedSpend[]>;
	monthSummary(month: MonthKey): Promise<MonthSummaryResponse>;
	monthReport(month: MonthKey): Promise<MonthReport>;
	goals(): Promise<GoalsListResponse>;
	/** Assinaturas (recorrências de despesa) ativas. */
	subscriptions(): Promise<RegisteredSubscription[]>;
	/** Ids dos lançamentos que nasceram de uma recorrência nos meses informados. */
	recurringTransactionIds(months: readonly MonthKey[]): Promise<Set<string>>;
}

/** O Vigia olha a última semana; o resto do mês e os anteriores servem de histórico. */
export const VIGIA_RECENT_DAYS = 7;
export const VIGIA_HISTORY_MONTHS = 3;
export const HUNT_MONTHS = 6;
export const PRICE_LOOKBACK_DAYS = 45;

/** Escolhas do agente: as salvas valem; o que faltar ou estiver inválido volta ao padrão do catálogo. */
export function settingsFor<K extends Exclude<BuiltinAgentKey, "orbita">>(
	key: K,
	raw: Record<string, unknown>,
): AgentSettingsOf<K> {
	const schema = agentSettingsSchemas[key];
	const defaults = BUILTIN_AGENTS[key].defaultSettings;
	const merged = schema.safeParse({ ...defaults, ...raw });
	return (merged.success ? merged.data : schema.parse(defaults)) as AgentSettingsOf<K>;
}

const candidate = (
	kind: AlertKind,
	dedupeKey: string,
	text: AlertText,
	data: object,
	transactionId: string | null = null,
): AlertCandidate => ({ kind, dedupeKey, ...text, data: { ...data }, transactionId });

async function collectVigia(raw: Record<string, unknown>, port: FindingsPort): Promise<AlertCandidate[]> {
	const settings = settingsFor("vigia", raw);
	const out: AlertCandidate[] = [];
	const month = monthOf(port.today);
	const recentFrom = addDays(port.today, -VIGIA_RECENT_DAYS);

	if (settings.unusualSpending || settings.duplicateCharge) {
		const all = await port.expenses({
			from: `${addMonths(month, -VIGIA_HISTORY_MONTHS)}-01`,
			to: port.today,
		});
		if (settings.unusualSpending) {
			const recent = all.filter((t) => t.date >= recentFrom);
			for (const f of detectUnusualSpending({ recent, history: all, minCents: settings.unusualMinCents })) {
				out.push(
					candidate(
						"unusual_spending",
						`unusual:${f.transactionId}`,
						unusualSpendingText(f, port.categoryName(f.categoryId)),
						f,
						f.transactionId,
					),
				);
			}
		}
		if (settings.duplicateCharge) {
			const found = detectDuplicateCharges({
				transactions: all,
				windowDays: settings.duplicateWindowDays,
				since: recentFrom,
			});
			for (const f of found) {
				out.push(
					candidate(
						"duplicate_charge",
						`dup:${f.firstTransactionId}:${f.transactionId}`,
						duplicateChargeText(f),
						f,
						f.transactionId,
					),
				);
			}
		}
	}

	if (settings.budgetThreshold) {
		const summary = await port.monthSummary(month);
		const hits = detectBudgetThresholds({
			budgets: summary.budgets,
			thresholdPercent: summary.budgetAlertPercent,
		});
		for (const f of hits) {
			const category = f.scope === "total" ? null : port.categoryName(f.scope);
			out.push(
				candidate(
					"budget_threshold",
					`budget:${f.scope}:${month}:${f.level}`,
					budgetThresholdText(f, category),
					f,
				),
			);
		}
	}
	return out;
}

async function collectFechamento(
	raw: Record<string, unknown>,
	port: FindingsPort,
): Promise<AlertCandidate[]> {
	const settings = settingsFor("fechamento", raw);
	if (!settings.monthlySummary) return [];
	// O mês que acabou de fechar (o corrente ainda está em andamento).
	const month = addMonths(monthOf(port.today), -1);
	const closing = closeMonth(await port.monthReport(month));
	if (closing === null) return [];
	const text = monthClosingText(closing, {
		categoryName: (id) => port.categoryName(id),
		compareWithPrevious: settings.compareWithPrevious,
		suggestLeftover: settings.suggestLeftover,
	});
	return [candidate("month_closing", `closing:${month}`, text, closing)];
}

async function collectMetas(raw: Record<string, unknown>, port: FindingsPort): Promise<AlertCandidate[]> {
	const settings = settingsFor("metas", raw);
	if (!settings.warnBehind) return [];
	const month = monthOf(port.today);
	const { goals } = await port.goals();
	const facts: GoalFacts[] = goals.map((g) => ({
		id: g.id,
		name: g.name,
		targetCents: g.targetCents,
		savedCents: g.savedCents,
		remainingCents: g.remainingCents,
		percent: g.percent,
		status: g.status,
		deadline: g.deadline,
		monthsLeft: g.monthsLeft,
		monthlyNeededCents: g.monthlyNeededCents,
		paceCents: g.paceCents,
		projectedDate: g.projectedDate,
	}));
	// Uma vez por mês enquanto a meta estiver atrasada.
	return goalsBehindPace(facts).map((f) =>
		candidate("goal_behind", `goal:${f.goalId}:${month}`, goalBehindText(f), f),
	);
}

async function collectCaca(raw: Record<string, unknown>, port: FindingsPort): Promise<AlertCandidate[]> {
	const settings = settingsFor("caca_assinatura", raw);
	if (!settings.findRecurring && !settings.priceIncrease) return [];
	const month = monthOf(port.today);
	const months = Array.from({ length: HUNT_MONTHS }, (_, i) => addMonths(month, -i));
	const [spends, subscriptions, posted] = await Promise.all([
		port.expenses({ from: `${addMonths(month, -(HUNT_MONTHS - 1))}-01`, to: port.today }),
		port.subscriptions(),
		port.recurringTransactionIds(months),
	]);
	const charges: HuntedCharge[] = spends.map((t) => ({
		id: t.id,
		date: t.date,
		amountCents: t.amountCents,
		merchant: t.merchant,
	}));
	const out: AlertCandidate[] = [];
	if (settings.findRecurring) {
		const found = detectRecurringCharges({
			charges,
			registeredNames: subscriptions.map((s) => s.name),
			excludeIds: posted,
			today: port.today,
		});
		for (const f of found) {
			out.push(
				candidate(
					"new_subscription",
					`subscription:${merchantKey(f.merchant, 1)}`,
					newSubscriptionText(f),
					f,
					f.lastTransactionId,
				),
			);
		}
	}
	if (settings.priceIncrease) {
		const found = detectPriceIncreases({
			subscriptions,
			charges,
			sinceDate: addDays(port.today, -PRICE_LOOKBACK_DAYS),
			excludeIds: posted,
		});
		for (const f of found) {
			out.push(
				candidate(
					"price_increase",
					`price:${f.subscriptionId}:${f.newCents}`,
					priceIncreaseText(f),
					f,
					f.transactionId,
				),
			);
		}
	}
	return out;
}

async function collectCofrinho(raw: Record<string, unknown>, port: FindingsPort): Promise<AlertCandidate[]> {
	const settings = settingsFor("cofrinho", raw);
	if (!settings.suggestSaving) return [];
	const month = monthOf(port.today);
	const summary = await port.monthSummary(month);
	const total = summary.budgets.find((b) => b.scope === "total");
	const saving = suggestSaving({
		budgetCents: total?.limitCents ?? null,
		projectedCents: summary.projection?.projectedCents ?? null,
		lowConfidence: summary.projection?.lowConfidence ?? false,
		minCents: settings.minCents,
	});
	// Só uma sugestão: nenhum dinheiro é movido e nenhuma proposta de escrita é criada.
	return saving === null
		? []
		: [candidate("saving_suggestion", `saving:${month}`, savingSuggestionText(saving), saving)];
}

/** Os avisos de um agente da casa, decididos só pelo engine. A Órbita não tem avisos próprios. */
export async function collectAlerts(
	agent: { builtinKey: BuiltinAgentKey; settings: Record<string, unknown> },
	port: FindingsPort,
): Promise<AlertCandidate[]> {
	switch (agent.builtinKey) {
		case "vigia":
			return collectVigia(agent.settings, port);
		case "fechamento":
			return collectFechamento(agent.settings, port);
		case "metas":
			return collectMetas(agent.settings, port);
		case "caca_assinatura":
			return collectCaca(agent.settings, port);
		case "cofrinho":
			return collectCofrinho(agent.settings, port);
		case "orbita":
			return [];
	}
}
