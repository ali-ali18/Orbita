import { suggestBudget } from "./budget-suggestion.ts";
import { UNCATEGORIZED } from "./classification.ts";
import { parseMonthKey } from "./dates.ts";
import { scaleDownToFit } from "./fit-limits.ts";
import { assertCents, formatBRL, sumCents } from "./money.ts";
import type { Cents, MonthKey } from "./types.ts";

/** Parte da renda que vai para a reserva de emergência, se o dono não escolheu outra. */
export const DEFAULT_RESERVE_PERCENT = 10;

export type CommitmentSource = "recurrence" | "installment" | "fixed_budget";

/** Um compromisso do mês: assinatura/recorrência, parcela que vence na fatura do mês ou limite de categoria fixa. */
export interface PlanCommitment {
	id: string;
	name: string;
	/** `null` cai em Outros. */
	categoryId: string | null;
	amountCents: Cents;
	source: CommitmentSource;
}

export interface PlanGoal {
	id: string;
	name: string;
	/** Do engine de metas (`summarizeGoal`); `null` = meta sem prazo, não pede valor mensal. */
	monthlyNeededCents: Cents | null;
}

export interface IncomePlanInput {
	month: MonthKey;
	/** A renda do mês (`incomeForMonth`). */
	incomeCents: Cents;
	/** Recorrências de despesa ativas e parcelas do mês. */
	commitments: readonly PlanCommitment[];
	/**
	 * Limites do orçamento nas categorias fixas (moradia…), por id. Valem como compromisso quando passam do que as
	 * recorrências e parcelas já somam naquela categoria.
	 */
	fixedBudgets?: Readonly<Record<string, Cents>>;
	/** Gasto por categoria dos meses fechados mais recentes (a entrada de `suggestBudget`). */
	history: readonly Readonly<Record<string, Cents>>[];
	goals: readonly PlanGoal[];
	/** Inteiro de 0 a 100. Padrão: `DEFAULT_RESERVE_PERCENT`. */
	reservePercent?: number;
	/** Categorias que não são gasto (investimentos): ficam fora do dia a dia e dos limites. */
	excludeCategoryIds?: readonly string[];
}

export type PlanWarningCode =
	| "no_income"
	| "no_history"
	| "commitments_exceed_income"
	| "plan_exceeds_income"
	| "scaled_to_fit";

export interface PlanWarning {
	code: PlanWarningCode;
	/** Texto para o dono, em pt-BR. */
	message: string;
	/** Quanto passou (ou foi cortado); 0 quando não se aplica. */
	amountCents: Cents;
}

export interface PlanBuckets {
	/** Assinaturas, parcelas e categorias fixas. */
	commitmentsCents: Cents;
	/** Mediana dos meses fechados por categoria, sem o que já é compromisso (reduzida se não coube). */
	dailyCents: Cents;
	goalsCents: Cents;
	reserveCents: Cents;
	/** Renda menos tudo acima. Negativo = o plano não cabe. */
	leftCents: Cents;
}

export interface PlanCategoryRow {
	categoryId: string;
	commitmentsCents: Cents;
	dailyCents: Cents;
	totalCents: Cents;
}

export interface IncomePlan {
	month: MonthKey;
	incomeCents: Cents;
	reservePercent: number;
	/** `false` quando só os compromissos já passam da renda: não há plano a aplicar. */
	feasible: boolean;
	buckets: PlanBuckets;
	/** Os compromissos que entraram, já com a categoria definida (sem categoria = Outros). */
	commitments: PlanCommitment[];
	goals: Array<{ id: string; name: string; amountCents: Cents }>;
	/** Por categoria, só as que têm algum valor, da maior para a menor. */
	categories: PlanCategoryRow[];
	/**
	 * O que "Aplicar ao orçamento" grava: compromissos + dia a dia (meta e reserva não são gasto). O total é sempre
	 * a soma dos limites das categorias. Vazio quando não é viável.
	 */
	budget: { totalCents: Cents; byCategory: Record<string, Cents> };
	/** Quanto o histórico pedia (compromissos + mediana) e o teto que coube; `null` se não precisou cortar. */
	cut: { wantedCents: Cents; capCents: Cents } | null;
	/** Quantos meses de histórico entraram no dia a dia (0 = sem histórico). */
	monthsUsed: number;
	warnings: PlanWarning[];
}

const warn = (code: PlanWarningCode, message: string, amountCents: Cents = 0): PlanWarning => ({
	code,
	message,
	amountCents,
});

/** Percentual de uma quantia em centavos, para baixo, só com inteiros. */
function percentOf(cents: Cents, percent: number): Cents {
	const product = cents * percent;
	if (!Number.isSafeInteger(product)) throw new RangeError("conta excede o inteiro seguro");
	return Math.floor(product / 100);
}

/**
 * Sugestão de como distribuir a renda do mês, a partir de dados reais. Determinística, sem IA:
 *
 * 1. compromissos: recorrências de despesa, parcelas que vencem no mês e limites de categorias fixas (nunca encolhem);
 * 2. dia a dia: a mediana dos meses fechados por categoria (`suggestBudget`), menos o que já é compromisso na
 *    categoria (o histórico já contém o aluguel pago, então somar os dois contaria duas vezes);
 * 3. metas: o valor mensal que cada uma pede (`summarizeGoal`);
 * 4. reserva: um percentual da renda;
 * 5. regra de ouro: nunca sugerir gastar mais que a renda. Se compromissos + dia a dia passam de
 *    renda − reserva − metas, o dia a dia é reduzido proporcionalmente (`scaleDownToFit`);
 * 6. sobra: o que resta (negativo só quando reserva e metas não cabem; então há aviso).
 *
 * Se só os compromissos já passam da renda, o plano não é viável (`feasible: false`) e nenhum limite é sugerido.
 */
export function incomePlan(input: IncomePlanInput): IncomePlan {
	parseMonthKey(input.month);
	assertCents(input.incomeCents, "incomeCents");
	if (input.incomeCents < 0) throw new RangeError("a renda não pode ser negativa");
	const reservePercent = input.reservePercent ?? DEFAULT_RESERVE_PERCENT;
	if (!Number.isInteger(reservePercent) || reservePercent < 0 || reservePercent > 100) {
		throw new RangeError("a reserva vai de 0% a 100%");
	}
	const excluded = new Set(input.excludeCategoryIds ?? []);

	// Compromissos: sem categoria viram Outros, para a soma por categoria fechar com o total.
	const commitments: PlanCommitment[] = input.commitments
		.map((c) => {
			assertCents(c.amountCents, `compromisso ${c.id}`);
			if (c.amountCents <= 0) throw new RangeError(`compromisso ${c.id}: o valor deve ser positivo`);
			return { ...c, categoryId: c.categoryId ?? UNCATEGORIZED };
		})
		.filter((c) => !excluded.has(c.categoryId as string));
	const committedBy = new Map<string, Cents>();
	for (const c of commitments) {
		const id = c.categoryId as string;
		committedBy.set(id, (committedBy.get(id) ?? 0) + c.amountCents);
	}

	// Categoria fixa com limite maior que as recorrências e parcelas: a diferença também é compromisso.
	const fixed = Object.entries(input.fixedBudgets ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
	for (const [categoryId, limit] of fixed) {
		assertCents(limit, `limite de ${categoryId}`);
		if (excluded.has(categoryId)) continue;
		const current = committedBy.get(categoryId) ?? 0;
		if (limit <= current) continue;
		commitments.push({
			id: `fixed:${categoryId}`,
			name: "Limite da categoria fixa",
			categoryId,
			amountCents: limit - current,
			source: "fixed_budget",
		});
		committedBy.set(categoryId, limit);
	}

	const history = input.history.map((m) =>
		Object.fromEntries(Object.entries(m).filter(([id]) => !excluded.has(id))),
	);
	const suggestion = suggestBudget(history);
	const categoryIds = [...new Set([...committedBy.keys(), ...Object.keys(suggestion.byCategory)])].sort();
	const rawDaily: Record<string, Cents> = {};
	for (const id of categoryIds) {
		rawDaily[id] = Math.max(0, (suggestion.byCategory[id] ?? 0) - (committedBy.get(id) ?? 0));
	}

	const goals = input.goals.flatMap((g) => {
		if (g.monthlyNeededCents === null) return [];
		assertCents(g.monthlyNeededCents, `meta ${g.id}`);
		return g.monthlyNeededCents > 0 ? [{ id: g.id, name: g.name, amountCents: g.monthlyNeededCents }] : [];
	});

	const commitmentsCents = sumCents([...committedBy.values()]);
	const goalsCents = sumCents(goals.map((g) => g.amountCents));
	const reserveCents = percentOf(input.incomeCents, reservePercent);
	const rawDailyCents = sumCents(Object.values(rawDaily));
	const warnings: PlanWarning[] = [];

	const feasible = input.incomeCents > 0 && commitmentsCents <= input.incomeCents;
	let daily = rawDaily;
	let cut: IncomePlan["cut"] = null;
	if (input.incomeCents === 0) {
		warnings.push(warn("no_income", "Cadastre sua renda para organizar o mês."));
	} else if (!feasible) {
		warnings.push(
			warn(
				"commitments_exceed_income",
				`Seus compromissos (${formatBRL(commitmentsCents)}) passam da renda (${formatBRL(input.incomeCents)}). Reveja assinaturas e parcelas antes de montar o orçamento.`,
				commitmentsCents - input.incomeCents,
			),
		);
	} else {
		// O que sobra para gastar depois da reserva e das metas; os compromissos entram primeiro e não encolhem.
		const capCents = Math.max(commitmentsCents, input.incomeCents - reserveCents - goalsCents);
		const room = capCents - commitmentsCents;
		if (rawDailyCents > room) {
			daily = scaleDownToFit(rawDaily, room);
			cut = { wantedCents: commitmentsCents + rawDailyCents, capCents };
			warnings.push(
				warn(
					"scaled_to_fit",
					`Seu histórico de gastos é ${formatBRL(cut.wantedCents)}, acima do que cabe na renda; ajustei os limites para caber em ${formatBRL(capCents)}.`,
					cut.wantedCents - capCents,
				),
			);
		}
		if (input.incomeCents - reserveCents - goalsCents < commitmentsCents) {
			warnings.push(
				warn(
					"plan_exceeds_income",
					"Depois dos compromissos não sobra para a reserva e as metas deste mês.",
					commitmentsCents + reserveCents + goalsCents - input.incomeCents,
				),
			);
		}
	}
	if (suggestion.monthsUsed === 0) {
		warnings.push(
			warn(
				"no_history",
				"Ainda não há gastos de meses anteriores, então o dia a dia ficou de fora do plano.",
			),
		);
	}

	const rows: PlanCategoryRow[] = [];
	for (const categoryId of categoryIds) {
		const committed = committedBy.get(categoryId) ?? 0;
		const dailyCents = feasible ? (daily[categoryId] ?? 0) : (rawDaily[categoryId] ?? 0);
		if (committed + dailyCents <= 0) continue;
		rows.push({ categoryId, commitmentsCents: committed, dailyCents, totalCents: committed + dailyCents });
	}
	rows.sort((a, b) => b.totalCents - a.totalCents || (a.categoryId < b.categoryId ? -1 : 1));

	const dailyCents = sumCents(rows.map((r) => r.dailyCents));
	const budgetByCategory = feasible ? Object.fromEntries(rows.map((r) => [r.categoryId, r.totalCents])) : {};
	return {
		month: input.month,
		incomeCents: input.incomeCents,
		reservePercent,
		feasible,
		buckets: {
			commitmentsCents,
			dailyCents,
			goalsCents,
			reserveCents,
			leftCents: input.incomeCents - commitmentsCents - dailyCents - goalsCents - reserveCents,
		},
		commitments,
		goals,
		categories: rows,
		budget: { totalCents: sumCents(Object.values(budgetByCategory)), byCategory: budgetByCategory },
		cut,
		monthsUsed: suggestion.monthsUsed,
		warnings,
	};
}
