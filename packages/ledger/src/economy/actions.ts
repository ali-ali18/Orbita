import type { SavingsReading } from "@orbita/agents";
import type { SavingsInput } from "@orbita/core";
import {
	type AutonomousActionKind,
	addDays,
	addMonths,
	type BudgetCandidate,
	type DuplicateCandidate,
	detectDuplicateCharges,
	type LocalDate,
	monthOf,
	type PlannedAction,
	planAutonomousActions,
	SAVINGS_GOAL_NAME,
	type SubscriptionCandidate,
	sameSubscriptionBrand,
	subscriptionBrand,
	toLocalDate,
	type UncategorizedCandidate,
	type WatchedSpend,
} from "@orbita/core";
import { type ActivityRecord, type AgentRecord, DataError, type Stores } from "@orbita/db";
import { pickCategoryRule } from "@orbita/shared";
import { loadSetupAnalysis } from "../setup.ts";
import { economySettings, loadSavingsInput } from "./savings.ts";

/*
 * Executa e desfaz o que o agente Economia faz SOZINHO. Só cinco ações existem (`AUTONOMOUS_ACTION_KINDS`) e todas
 * têm Desfazer; não há caminho aqui para apagar lançamento, mover dinheiro, pagar ou mexer em dado do banco.
 *
 * Cada ação passa por: reservar o registro (idempotência: o par agente + achado é único) → reler o que vai mexer e
 * conferir que o dono não o editou → executar → guardar no registro o que o Desfazer precisa. Se a execução falha, a
 * reserva é solta e o achado pode ser tentado na próxima vez.
 */

export interface EconomyRunResult {
	/** Quantas ações o planejador pediu. */
	planned: number;
	/** O que foi feito de fato. */
	applied: ActivityRecord[];
	/** Pedidas, mas fora de hora: o dono mudou o que seria tocado, ou já havia registro. */
	skipped: number;
	failed: number;
}

/** O que o Desfazer guarda por tipo de ação (estado anterior e ids criados). */
type UndoData = Record<string, unknown>;

type Applied = { undo: UndoData } | null;

// ------------------------------------------------------------------ entrada do planejador

async function gatherInput(
	stores: Stores,
	agent: AgentRecord,
	today: LocalDate,
	reading: SavingsReading,
	input: SavingsInput,
): Promise<Parameters<typeof planAutonomousActions>[0]> {
	const settings = economySettings(agent);
	const month = monthOf(today);
	const [alreadyDone, categories, rules, budgets, goals, analysis] = await Promise.all([
		stores.agentActivity.keys(agent.id),
		stores.categories.list(),
		stores.categoryRules.list(),
		stores.budgets.list(),
		stores.goals.list(),
		loadSetupAnalysis(stores, today),
	]);
	const activeCategories = new Set(categories.filter((c) => c.archivedAt === null).map((c) => c.id));
	const categoryNames = new Map(categories.map((c) => [c.id, c.name]));

	// Sem categoria: só os do mês e do anterior (o passado distante o dono já viu).
	const recent = (
		await Promise.all([month, addMonths(month, -1)].map((m) => stores.transactions.listByBudgetMonth(m)))
	)
		.flat()
		.filter((t) => t.kind === "expense" && t.categoryId === null);
	const uncategorized: UncategorizedCandidate[] = recent.map((t) => {
		const rule = pickCategoryRule(rules, t.merchantName, t.description);
		return {
			id: t.id,
			date: t.date,
			amountCents: t.amountCents,
			merchant: t.merchantName ?? t.description,
			ruleCategoryId: rule && activeCategories.has(rule.categoryId) ? rule.categoryId : null,
			ruleCategoryName: rule ? (categoryNames.get(rule.categoryId) ?? "") : "",
			editedByOwner: t.editedByOwner,
			categoryEditedByOwner: t.categoryEditedByOwner,
			categoryId: t.categoryId,
		};
	});

	// Assinaturas detectadas: a mesma análise do "Configurar com a Órbita" (um número só no app inteiro).
	const subscriptions: SubscriptionCandidate[] = analysis.recurring
		.filter((r) => !r.registered)
		.map((r) => {
			// `rec:<marca>` ou `rec:<marca>:<valor>` (dois planos da mesma marca).
			const brand = r.key.split(":")[1] ?? r.key;
			const evidence = input.spends
				.filter((s) => sameSubscriptionBrand(subscriptionBrand(s.brandText ?? s.merchant), brand))
				.sort((a, b) => (a.date < b.date ? 1 : -1))
				.slice(0, 5)
				.map((s) => s.id);
			return {
				merchant: r.merchant,
				name: r.displayName,
				amountCents: r.amountCents,
				occurrences: r.occurrences,
				known: r.knownService !== null,
				dayOfMonth: r.dayOfMonth,
				startDate: r.startDate,
				cardId: r.cardId,
				accountId: r.accountId,
				evidenceIds: evidence,
				brand,
				categoryId: r.categoryId && activeCategories.has(r.categoryId) ? r.categoryId : null,
			};
		});

	const budgetCandidates: BudgetCandidate[] = reading.result.opportunities.flatMap((o) =>
		o.type === "category_above_average"
			? [
					{
						categoryId: o.detail.categoryId,
						categoryName: categoryNames.get(o.detail.categoryId) ?? "",
						limitCents: o.detail.suggestedLimitCents,
						evidenceIds: o.evidence.transactionIds,
						spentCents: o.detail.spentCents,
						averageCents: o.detail.averageCents,
					},
				]
			: [],
	);

	// Cobrança repetida nos últimos 7 dias (a mesma regra do Vigia: mesmo valor e estabelecimento em até 3 dias).
	const watched: WatchedSpend[] = input.spends.map((s) => ({
		id: s.id,
		date: s.date,
		amountCents: s.amountCents,
		categoryId: s.categoryId,
		merchant: s.merchant,
		installmentGroupId: s.installmentGroupId ?? null,
	}));
	const found = detectDuplicateCharges({ transactions: watched, windowDays: 3, since: addDays(today, -7) });
	const duplicates: DuplicateCandidate[] = [];
	for (const d of found) {
		const [a, b] = await Promise.all([
			stores.transactions.get(d.firstTransactionId),
			stores.transactions.get(d.transactionId),
		]);
		if (!a || !b) continue;
		duplicates.push({
			transactionId: d.transactionId,
			firstTransactionId: d.firstTransactionId,
			merchant: d.merchant,
			amountCents: d.amountCents,
			editedByOwner: a.editedByOwner || b.editedByOwner,
			alreadyPending: b.status === "pending",
		});
	}

	return {
		level: settings.autonomy,
		maxActions: settings.maxActionsPerRun,
		alreadyDone,
		uncategorized,
		subscriptions,
		budgetScopes: new Set(budgets.map((b) => b.scope)),
		budgets: budgetCandidates,
		duplicates,
		monthlySavingsCents: reading.result.totalMonthlySavingsCents,
		hasSavingsGoal: goals.some((g) => g.name === SAVINGS_GOAL_NAME),
	};
}

// ------------------------------------------------------------------ executar

async function apply(stores: Stores, action: PlannedAction): Promise<Applied> {
	switch (action.kind) {
		case "categorize_transaction": {
			const { transactionId, categoryId } = action.payload;
			const t = await stores.transactions.get(transactionId);
			// Reler na hora: o dono pode ter editado entre o planejamento e agora.
			if (!t) return null;
			if (t.kind !== "expense" || t.categoryId !== null) return null;
			if (t.editedByOwner || t.categoryEditedByOwner) return null;
			const category = await stores.categories.get(categoryId);
			if (!category || category.archivedAt !== null) return null;
			await stores.transactions.update(transactionId, { categoryId });
			return { undo: { transactionId, categoryId, previousCategoryId: null } };
		}
		case "register_subscription": {
			const p = action.payload;
			const place = p.cardId
				? await stores.cards.get(p.cardId)
				: p.accountId
					? await stores.accounts.get(p.accountId)
					: null;
			if (!place || place.archivedAt !== null) return null;
			const existing = (await stores.recurrences.list()).filter((r) => r.kind === "expense");
			const brand = subscriptionBrand(p.name);
			if (brand !== "" && existing.some((r) => sameSubscriptionBrand(subscriptionBrand(r.name), brand))) {
				return null;
			}
			let categoryId = p.categoryId;
			if (categoryId !== null) {
				const category = await stores.categories.get(categoryId);
				if (!category || category.archivedAt !== null) categoryId = null;
			}
			const created = await stores.recurrences.create({
				kind: "expense",
				name: p.name.slice(0, 60),
				amountCents: p.amountCents,
				dayOfMonth: p.dayOfMonth,
				startDate: p.startDate,
				categoryId,
				accountId: p.cardId ? null : p.accountId,
				cardId: p.cardId,
			});
			return { undo: { recurrenceId: created.id } };
		}
		case "set_budget_limit": {
			const { categoryId, limitCents } = action.payload;
			const category = await stores.categories.get(categoryId);
			if (!category || category.archivedAt !== null) return null;
			// O agente só cria: se o dono já pôs um limite (mesmo depois do planejamento), não mexe.
			if ((await stores.budgets.list()).some((b) => b.scope === categoryId)) return null;
			await stores.budgets.set(categoryId, limitCents);
			return { undo: { scope: categoryId, limitCents } };
		}
		case "flag_duplicate": {
			const { transactionId } = action.payload;
			const t = await stores.transactions.get(transactionId);
			if (!t) return null;
			if (t.kind !== "expense" || t.editedByOwner || t.status !== "confirmed") return null;
			await stores.transactions.update(transactionId, { status: "pending" });
			return { undo: { transactionId, previousStatus: "confirmed" } };
		}
		case "create_savings_goal": {
			if ((await stores.goals.list()).some((g) => g.name === action.payload.name)) return null;
			const created = await stores.goals.create({
				name: action.payload.name,
				targetCents: action.payload.targetCents,
			});
			return { undo: { goalId: created.id } };
		}
	}
}

/**
 * Planeja e executa o que o agente pode fazer sozinho agora. Nível "Só avisar" não faz nada. Cada ação já vai para o
 * registro, com o motivo e a evidência; o limite por execução é `maxActionsPerRun` das escolhas do dono.
 */
export async function runEconomyActions(
	stores: Stores,
	now: () => Date,
	agent: AgentRecord,
	context: { reading: SavingsReading; input?: SavingsInput },
): Promise<EconomyRunResult> {
	const result: EconomyRunResult = { planned: 0, applied: [], skipped: 0, failed: 0 };
	if (economySettings(agent).autonomy !== "reversible") return result;
	const today = toLocalDate(now());
	const input = context.input ?? (await loadSavingsInput(stores, today));
	const plan = planAutonomousActions(await gatherInput(stores, agent, today, context.reading, input));
	result.planned = plan.length;

	for (const action of plan) {
		const reserved = await stores.agentActivity.reserve(agent.id, {
			kind: action.kind,
			dedupeKey: action.dedupeKey,
			summary: action.summary,
			reason: action.reason,
			evidence: action.evidence,
		});
		if (reserved === null) {
			result.skipped += 1;
			continue;
		}
		try {
			const applied = await apply(stores, action);
			if (applied === null) {
				// O dono mudou o que seria tocado: solta a reserva, para o achado voltar se a situação mudar.
				await stores.agentActivity.release(reserved.id);
				result.skipped += 1;
				continue;
			}
			const saved = await stores.agentActivity.setUndo(reserved.id, applied.undo);
			result.applied.push(saved ?? reserved);
		} catch {
			await stores.agentActivity.release(reserved.id).catch(() => undefined);
			result.failed += 1;
		}
	}
	return result;
}

// ------------------------------------------------------------------ desfazer

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** Devolve o estado anterior e, se não deu para mexer (o dono já tinha mudado), o motivo em uma frase. */
async function revert(stores: Stores, kind: AutonomousActionKind, undo: UndoData): Promise<string | null> {
	switch (kind) {
		case "categorize_transaction": {
			const id = str(undo.transactionId);
			if (id === null) return "Não havia o que desfazer.";
			const t = await stores.transactions.get(id);
			if (!t) return "O lançamento foi apagado.";
			if (t.categoryId !== str(undo.categoryId) || t.categoryEditedByOwner || t.editedByOwner) {
				return "Você já tinha mudado esse lançamento; deixei como está.";
			}
			await stores.transactions.update(id, { categoryId: null });
			return null;
		}
		case "register_subscription": {
			const id = str(undo.recurrenceId);
			const r = id === null ? null : await stores.recurrences.get(id);
			if (!r) return "A assinatura já tinha sido apagada.";
			if (r.archivedAt === null) await stores.recurrences.archive(r.id);
			return null;
		}
		case "set_budget_limit": {
			const scope = str(undo.scope);
			const current = (await stores.budgets.list()).find((b) => b.scope === scope);
			if (!scope || !current) return "O limite já tinha sido removido.";
			if (current.limitCents !== undo.limitCents)
				return "Você já tinha mudado esse limite; deixei como está.";
			await stores.budgets.remove(scope);
			return null;
		}
		case "flag_duplicate": {
			const id = str(undo.transactionId);
			const t = id === null ? null : await stores.transactions.get(id);
			if (!t) return "O lançamento foi apagado.";
			if (t.editedByOwner || t.status !== "pending")
				return "Você já revisou esse lançamento; deixei como está.";
			await stores.transactions.update(t.id, { status: "confirmed" });
			return null;
		}
		case "create_savings_goal": {
			const id = str(undo.goalId);
			const goal = id === null ? null : await stores.goals.get(id);
			if (!goal || goal.archivedAt !== null) return "A meta já tinha sido removida.";
			if ((await stores.goals.listContributions([goal.id])).length > 0) {
				return "A meta já tem dinheiro guardado; mantive.";
			}
			await stores.goals.archive(goal.id);
			return null;
		}
	}
}

export interface UndoResult {
	activity: ActivityRecord;
	/** `false` quando nada foi mexido (o dono já tinha mudado); `activity.undoNote` diz por quê. */
	reverted: boolean;
}

/**
 * Desfaz uma atividade do agente. A troca `done` → `undone` é comparar-e-trocar atômico: dois toques seguidos
 * desfazem uma vez só e o segundo leva `duplicate`. Se devolver o estado falha, a atividade volta a `done`.
 * Nunca toca no que o dono mudou depois: nesse caso só marca como desfeita, com a nota.
 */
export async function undoActivity(stores: Stores, id: string): Promise<UndoResult> {
	const found = await stores.agentActivity.get(id);
	if (!found) throw new DataError("not_found", "Atividade não encontrada.");
	const marked = await stores.agentActivity.markUndone(id);
	if (!marked) throw new DataError("duplicate", "Esta atividade já foi desfeita.");
	try {
		const note = await revert(stores, found.kind, found.undo);
		const activity = note === null ? marked : ((await stores.agentActivity.setUndoNote(id, note)) ?? marked);
		return { activity, reverted: note === null };
	} catch (error) {
		await stores.agentActivity.reopen(id).catch(() => undefined);
		throw error;
	}
}
