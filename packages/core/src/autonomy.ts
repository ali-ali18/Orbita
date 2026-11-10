import { formatBRL } from "./money.ts";
import type { Cents, LocalDate } from "./types.ts";

// biome-ignore lint/suspicious/noControlCharactersInRegex: é exatamente o que se quer remover
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;

/** Nome vindo de fora (estabelecimento, categoria) para uma frase do registro: sem controles nem marcação, curto. */
const label = (value: string, max = 40): string => {
	const text = value.replace(CONTROL, " ").replace(/[<>`]/g, "'").replace(/\s+/g, " ").trim();
	return text.length === 0 ? "—" : text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};
const money = (cents: Cents) => formatBRL(cents, { sign: "never" });

/*
 * Autonomia do agente Economia: o que ele PODE fazer sozinho e o que nunca faz. Função pura que decide, a partir
 * dos achados do engine, quais ações reversíveis valem a pena agora. Quem executa (`@orbita/ledger`) só recebe daqui
 * ações de uma lista fechada, e cada uma carrega o que o Desfazer precisa.
 *
 * Níveis:
 *  - "notify" (padrão): só avisa. Nenhuma ação.
 *  - "reversible": age sozinho, mas só em coisas que o Desfazer devolve inteiras (lista abaixo).
 *
 * NUNCA, em nível nenhum: apagar lançamento, mover dinheiro, pagar fatura ou conta, mexer em dados vindos do banco,
 * nem mudar algo que o dono editou (`editedByOwner`, `categoryEditedByOwner`). Não existe ação dessas na lista: não
 * é uma proibição checada depois, é uma capacidade que o agente não tem.
 */

export const AUTONOMY_LEVELS = ["notify", "reversible"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];
export const DEFAULT_AUTONOMY: AutonomyLevel = "notify";

/** As únicas ações que o agente executa sozinho. Todas se desfazem. */
export const AUTONOMOUS_ACTION_KINDS = [
	"categorize_transaction",
	"register_subscription",
	"set_budget_limit",
	"flag_duplicate",
	"create_savings_goal",
] as const;
export type AutonomousActionKind = (typeof AUTONOMOUS_ACTION_KINDS)[number];

/** O que o agente nunca faz sozinho (documentação executável: os testes conferem que nada disto está na lista acima). */
export const NEVER_AUTONOMOUS = [
	"delete_transaction",
	"move_money",
	"pay",
	"edit_bank_data",
	"override_owner_edit",
] as const;

export const DEFAULT_MAX_ACTIONS_PER_RUN = 5;
export const MAX_ACTIONS_PER_RUN_LIMIT = 20;

/** Assinatura detectada com confiança para cadastrar sozinho: 4 cobranças mensais, ou 3 de um serviço conhecido. */
export const SUBSCRIPTION_AUTO_MIN_OCCURRENCES = 4;
export const SUBSCRIPTION_AUTO_MIN_OCCURRENCES_KNOWN = 3;

/** A meta de economia nasce com o equivalente a 6 meses do corte estimado, arredondado para baixo a R$ 10. */
export const SAVINGS_GOAL_MONTHS = 6;
export const SAVINGS_GOAL_ROUND_CENTS = 1000;
/** Só cria a meta se o corte estimado por mês passar disto. */
export const SAVINGS_GOAL_MIN_MONTHLY_CENTS = 5000;

export interface UncategorizedCandidate {
	id: string;
	date: LocalDate;
	amountCents: Cents;
	merchant: string;
	/** Categoria que uma regra aprendida do dono aponta (a mesma que o sync usaria); `null` = nenhuma. */
	ruleCategoryId: string | null;
	/** Nome da categoria da regra (para o registro). */
	ruleCategoryName?: string;
	/** O dono mexeu no lançamento (tipo, data, valor, conta ou revisão). */
	editedByOwner: boolean;
	/** O dono escolheu a categoria à mão. */
	categoryEditedByOwner: boolean;
	/** O lançamento ainda não tem categoria. */
	categoryId: string | null;
}

export interface SubscriptionCandidate {
	merchant: string;
	/** Nome para o cadastro (o do app, quando o serviço é conhecido). */
	name: string;
	amountCents: Cents;
	occurrences: number;
	/** Serviço do catálogo de assinaturas conhecidas. */
	known: boolean;
	dayOfMonth: number;
	/** A assinatura começa a valer no mês seguinte à última cobrança (a atual já está lançada). */
	startDate: LocalDate;
	/** De onde saiu a cobrança: cartão, ou conta quando não é cartão. */
	cardId: string | null;
	accountId: string | null;
	/** Cobranças que sustentam o achado (as mais recentes). */
	evidenceIds: readonly string[];
	/** Chave estável do serviço (a marca). */
	brand: string;
	categoryId: string | null;
}

export interface BudgetCandidate {
	categoryId: string;
	/** Nome da categoria (para o registro). */
	categoryName?: string;
	/** O limite sugerido (a média dos 3 meses, em reais inteiros). */
	limitCents: Cents;
	/** Id dos lançamentos que mostram o gasto acima da média. */
	evidenceIds: readonly string[];
	spentCents: Cents;
	averageCents: Cents;
}

export interface DuplicateCandidate {
	transactionId: string;
	firstTransactionId: string;
	merchant: string;
	amountCents: Cents;
	/** O dono mexeu em algum dos dois, ou o lançamento já está para revisar. */
	editedByOwner: boolean;
	alreadyPending: boolean;
	/** Dias entre os dois lançamentos (0 = no mesmo dia). */
	daysApart: number;
	/** Origem de cada um (`manual`, `notification`, `pluggy`…). */
	sources: readonly [string, string];
	/** Quantas vezes o mesmo estabelecimento cobrou o mesmo valor nos últimos 30 dias (os dois deste par contam). */
	sameValueCount30d: number;
}

/** Cobrança que se repete 3 vezes ou mais no mês com o mesmo valor é hábito (passagem, café), não cobrança em dobro. */
export const DUPLICATE_HABIT_MIN_COUNT = 3;

/**
 * A ação autônoma é bem mais estrita que o aviso do Vigia: só o MESMO dia e com origens diferentes, uma delas o banco
 * (`pluggy`), porque o clássico dobro é o lançamento do dono (ou da notificação) mais o do banco. Duas linhas do próprio
 * banco nunca são marcadas sozinhas, e estabelecimento com hábito de cobrar o mesmo valor também não.
 */
export function isAutonomousDuplicate(d: DuplicateCandidate): boolean {
	const [a, b] = d.sources;
	return (
		d.daysApart === 0 &&
		a !== b &&
		(a === "pluggy" || b === "pluggy") &&
		d.sameValueCount30d < DUPLICATE_HABIT_MIN_COUNT
	);
}

export interface AutonomyInput {
	level: AutonomyLevel;
	/** Limite de ações por execução (1 a `MAX_ACTIONS_PER_RUN_LIMIT`). */
	maxActions: number;
	/** `dedupeKey` de tudo o que o agente já fez (inclusive o que o dono desfez: o que foi desfeito não volta sozinho). */
	alreadyDone: ReadonlySet<string>;
	uncategorized: readonly UncategorizedCandidate[];
	subscriptions: readonly SubscriptionCandidate[];
	/** Categorias que já têm limite de orçamento (o agente cria, nunca troca o limite que o dono pôs). */
	budgetScopes: ReadonlySet<string>;
	budgets: readonly BudgetCandidate[];
	duplicates: readonly DuplicateCandidate[];
	/** Corte mensal estimado pelo engine (`totalMonthlySavingsCents`) e se já existe meta de economia ativa. */
	monthlySavingsCents: Cents;
	hasSavingsGoal: boolean;
}

interface Planned<K extends AutonomousActionKind, P> {
	kind: K;
	/** Único por agente: o mesmo achado nunca vira duas ações (e o que foi desfeito não volta). */
	dedupeKey: string;
	/** Frase curta do que foi feito. */
	summary: string;
	/** Por quê, em palavras. */
	reason: string;
	evidence: { transactionIds: string[] };
	payload: P;
}

export type PlannedAction =
	| Planned<"categorize_transaction", { transactionId: string; categoryId: string }>
	| Planned<
			"register_subscription",
			{
				name: string;
				amountCents: Cents;
				dayOfMonth: number;
				startDate: LocalDate;
				cardId: string | null;
				accountId: string | null;
				categoryId: string | null;
			}
	  >
	| Planned<"set_budget_limit", { categoryId: string; limitCents: Cents }>
	| Planned<"flag_duplicate", { transactionId: string; firstTransactionId: string }>
	| Planned<"create_savings_goal", { name: string; targetCents: Cents }>;

/** Chaves de idempotência: uma função por tipo, para o planejador e o executor falarem a mesma língua. */
export const actionKey = {
	categorize: (transactionId: string) => `categorize:${transactionId}`,
	subscription: (brand: string, amountCents: Cents) => `subscription:${brand}:${amountCents}`,
	budget: (categoryId: string) => `budget:${categoryId}`,
	duplicate: (firstId: string, secondId: string) => `duplicate:${firstId}:${secondId}`,
	goal: () => "goal:economia",
} as const;

export const SAVINGS_GOAL_NAME = "Economia do mês";

export function isHighConfidenceSubscription(
	c: Pick<SubscriptionCandidate, "occurrences" | "known">,
): boolean {
	return (
		c.occurrences >= SUBSCRIPTION_AUTO_MIN_OCCURRENCES ||
		(c.known && c.occurrences >= SUBSCRIPTION_AUTO_MIN_OCCURRENCES_KNOWN)
	);
}

/**
 * O que o agente faz sozinho nesta execução, em ordem de valor e limitado a `maxActions`. Nível "notify" não faz
 * nada. Cada ação já passou por: não foi feita antes (nem desfeita), não toca em nada que o dono editou e é de uma
 * das cinco espécies reversíveis.
 */
export function planAutonomousActions(input: AutonomyInput): PlannedAction[] {
	if (input.level !== "reversible") return [];
	const cap = Math.min(Math.max(Math.floor(input.maxActions), 0), MAX_ACTIONS_PER_RUN_LIMIT);
	if (cap === 0) return [];
	const planned: PlannedAction[] = [];
	const seen = new Set<string>(input.alreadyDone);
	const add = (action: PlannedAction) => {
		if (seen.has(action.dedupeKey)) return;
		seen.add(action.dedupeKey);
		planned.push(action);
	};

	for (const s of input.subscriptions) {
		if (!isHighConfidenceSubscription(s) || s.amountCents <= 0) continue;
		// Sem cartão nem conta a assinatura não teria onde ser cobrada: o cadastro seria recusado.
		if (s.cardId === null && s.accountId === null) continue;
		add({
			kind: "register_subscription",
			dedupeKey: actionKey.subscription(s.brand, s.amountCents),
			summary: `Cadastrei a assinatura ${label(s.name)} (${money(s.amountCents)} por mês)`,
			reason: `${s.occurrences} cobranças mensais seguidas de valor parecido, ainda não estava nas Assinaturas.`,
			evidence: { transactionIds: [...s.evidenceIds] },
			payload: {
				name: s.name,
				amountCents: s.amountCents,
				dayOfMonth: Math.min(Math.max(s.dayOfMonth, 1), 28),
				startDate: s.startDate,
				cardId: s.cardId,
				accountId: s.cardId ? null : s.accountId,
				categoryId: s.categoryId,
			},
		});
	}

	for (const b of input.budgets) {
		// Só onde o dono não pôs limite: o limite dele nunca é trocado.
		if (input.budgetScopes.has(b.categoryId) || b.limitCents <= 0) continue;
		add({
			kind: "set_budget_limit",
			dedupeKey: actionKey.budget(b.categoryId),
			summary: `Criei um limite de ${money(b.limitCents)} para ${label(b.categoryName ?? "a categoria")}`,
			reason: `Neste mês já foram ${money(b.spentCents)}, contra a média de ${money(b.averageCents)} dos últimos 3 meses, e a categoria não tinha limite.`,
			evidence: { transactionIds: [...b.evidenceIds] },
			payload: { categoryId: b.categoryId, limitCents: b.limitCents },
		});
	}

	for (const d of input.duplicates) {
		if (d.editedByOwner || d.alreadyPending) continue;
		if (!isAutonomousDuplicate(d)) continue;
		add({
			kind: "flag_duplicate",
			dedupeKey: actionKey.duplicate(d.firstTransactionId, d.transactionId),
			summary: `Marquei ${label(d.merchant)} para revisar (${money(d.amountCents)})`,
			reason: "Mesmo estabelecimento e mesmo valor em poucos dias: pode ter sido cobrado em dobro.",
			evidence: { transactionIds: [d.firstTransactionId, d.transactionId] },
			payload: { transactionId: d.transactionId, firstTransactionId: d.firstTransactionId },
		});
	}

	for (const t of input.uncategorized) {
		if (t.categoryId !== null || t.ruleCategoryId === null) continue;
		if (t.editedByOwner || t.categoryEditedByOwner) continue;
		add({
			kind: "categorize_transaction",
			dedupeKey: actionKey.categorize(t.id),
			summary: `Categorizei ${label(t.merchant)} como ${label(t.ruleCategoryName ?? "a categoria da regra")}`,
			reason: "Uma regra que você ensinou casa com o estabelecimento.",
			evidence: { transactionIds: [t.id] },
			payload: { transactionId: t.id, categoryId: t.ruleCategoryId },
		});
	}

	if (!input.hasSavingsGoal && input.monthlySavingsCents >= SAVINGS_GOAL_MIN_MONTHLY_CENTS) {
		const target =
			Math.floor((input.monthlySavingsCents * SAVINGS_GOAL_MONTHS) / SAVINGS_GOAL_ROUND_CENTS) *
			SAVINGS_GOAL_ROUND_CENTS;
		if (target > 0) {
			add({
				kind: "create_savings_goal",
				dedupeKey: actionKey.goal(),
				summary: `Criei a meta ${SAVINGS_GOAL_NAME} de ${money(target)}`,
				reason: `Os cortes que achei somam ${money(input.monthlySavingsCents)} por mês; a meta é de ${SAVINGS_GOAL_MONTHS} meses disso.`,
				evidence: { transactionIds: [] },
				payload: { name: SAVINGS_GOAL_NAME, targetCents: target },
			});
		}
	}
	return planned.slice(0, cap);
}
