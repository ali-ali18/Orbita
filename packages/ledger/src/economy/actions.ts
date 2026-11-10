import { randomUUID } from "node:crypto";
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
	merchantKey,
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
import {
	ACTIVITY_MAX_ATTEMPTS,
	type ActivityRecord,
	type AgentRecord,
	DataError,
	type Stores,
} from "@orbita/db";
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

	// Candidatas: a regra do Vigia (mesmo valor e estabelecimento em até 3 dias, últimos 7 dias); o planejador então só
	// aceita as que passam na regra estrita da ação autônoma (`isAutonomousDuplicate`).
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
		// Vai para revisão o lançamento que NÃO é do banco (o do dono ou da notificação); a linha do banco é a referência.
		const flagB = b.source !== "pluggy" || a.source === "pluggy";
		duplicates.push({
			transactionId: flagB ? d.transactionId : d.firstTransactionId,
			firstTransactionId: flagB ? d.firstTransactionId : d.transactionId,
			merchant: d.merchant,
			amountCents: d.amountCents,
			editedByOwner: a.editedByOwner || b.editedByOwner,
			alreadyPending: (flagB ? b : a).status === "pending",
			daysApart: d.daysApart,
			sources: [a.source, b.source],
			sameValueCount30d: input.spends.filter(
				(s) =>
					s.amountCents === d.amountCents &&
					s.date >= addDays(today, -29) &&
					merchantKey(s.merchant) === merchantKey(d.merchant),
			).length,
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

/**
 * Passo 1 (só leitura): relê o que vai mexer, confere que o dono não editou e devolve o `undo` JÁ CALCULADO (estado
 * anterior e retrato do que será criado). `null` = não há o que fazer agora; nada foi gravado e nada foi reservado.
 */
async function prepare(stores: Stores, action: PlannedAction): Promise<Applied> {
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
			// O retrato do que será criado: o Desfazer só mexe se continuar assim (o dono pode renomear, trocar valor ou dia).
			return {
				undo: {
					// O id nasce aqui e vai para o registro ANTES de criar: só o que tem este id é do agente.
					recurrenceId: randomUUID(),
					name: p.name.slice(0, 60),
					amountCents: p.amountCents,
					dayOfMonth: p.dayOfMonth,
					startDate: p.startDate,
				},
			};
		}
		case "set_budget_limit": {
			const { categoryId, limitCents } = action.payload;
			const category = await stores.categories.get(categoryId);
			if (!category || category.archivedAt !== null) return null;
			// O agente só cria: se o dono já pôs um limite (mesmo depois do planejamento), não mexe.
			if ((await stores.budgets.list()).some((b) => b.scope === categoryId)) return null;
			return { undo: { scope: categoryId, limitCents } };
		}
		case "flag_duplicate": {
			const { transactionId } = action.payload;
			const t = await stores.transactions.get(transactionId);
			if (!t) return null;
			if (t.kind !== "expense" || t.editedByOwner || t.status !== "confirmed") return null;
			return { undo: { transactionId, previousStatus: "confirmed" } };
		}
		case "create_savings_goal": {
			if ((await stores.goals.list()).some((g) => g.name === action.payload.name)) return null;
			return {
				undo: { goalId: randomUUID(), name: action.payload.name, targetCents: action.payload.targetCents },
			};
		}
	}
}

/** Passo 2 (escrita): faz a mudança e devolve o `undo` completo (com os ids criados). */
async function execute(stores: Stores, action: PlannedAction, undo: UndoData): Promise<UndoData> {
	switch (action.kind) {
		case "categorize_transaction":
			await stores.transactions.update(action.payload.transactionId, {
				categoryId: action.payload.categoryId,
			});
			return undo;
		case "register_subscription": {
			const p = action.payload;
			let categoryId = p.categoryId;
			if (categoryId !== null) {
				const category = await stores.categories.get(categoryId);
				if (!category || category.archivedAt !== null) categoryId = null;
			}
			const created = await stores.recurrences.create({
				...(str(undo.recurrenceId) ? { id: str(undo.recurrenceId) as string } : {}),
				kind: "expense",
				name: p.name.slice(0, 60),
				amountCents: p.amountCents,
				dayOfMonth: p.dayOfMonth,
				startDate: p.startDate,
				categoryId,
				accountId: p.cardId ? null : p.accountId,
				cardId: p.cardId,
			});
			return { ...undo, recurrenceId: created.id };
		}
		case "set_budget_limit":
			await stores.budgets.set(action.payload.categoryId, action.payload.limitCents);
			return undo;
		case "flag_duplicate":
			await stores.transactions.update(action.payload.transactionId, { status: "pending" });
			return undo;
		case "create_savings_goal": {
			const created = await stores.goals.create({
				...(str(undo.goalId) ? { id: str(undo.goalId) as string } : {}),
				name: action.payload.name,
				targetCents: action.payload.targetCents,
			});
			return { ...undo, goalId: created.id };
		}
	}
}

/**
 * Resolve o que ficou `applying` (o processo caiu, ou o passo final falhou): se o estado mostra que a ação gravou,
 * conclui o registro com o `undo` completo; se comprovadamente não gravou, solta a reserva para o achado voltar.
 */
async function settleApplying(stores: Stores, agent: AgentRecord): Promise<void> {
	const stuck = (await stores.agentActivity.list({ agentId: agent.id, limit: 100 })).filter(
		(a) => a.status === "applying",
	);
	for (const a of stuck) {
		const undo = await detectApplied(stores, a.kind, a.undo);
		if (undo !== null) {
			await stores.agentActivity.finish(a.id, undo);
			continue;
		}
		// Comprovadamente não gravou: tenta de novo, no máximo ACTIVITY_MAX_ATTEMPTS vezes; depois fica `failed`.
		const attempts = Number(a.undo.attempts ?? 0) + 1;
		const next = { ...a.undo, attempts };
		if (attempts >= ACTIVITY_MAX_ATTEMPTS) await stores.agentActivity.markFailed(a.id, next);
		else await stores.agentActivity.markRetry(a.id, next);
	}
}

/**
 * O estado atual mostra que a ação gravou? Devolve o `undo` completo, ou `null` se não gravou.
 *
 * Assinatura e meta só valem pelo ID gerado na reserva (nunca por nome, valor ou dia iguais: o dono pode ter criado a
 * mesma coisa). Categoria, limite e situação não têm id criado pelo agente: se o estado já é o desejado, não há como
 * provar que foi o agente, então a atividade conclui com `unverified` e o Desfazer não mexe em nada.
 */
async function detectApplied(
	stores: Stores,
	kind: AutonomousActionKind,
	undo: UndoData,
): Promise<UndoData | null> {
	switch (kind) {
		case "categorize_transaction": {
			const t = await stores.transactions.get(str(undo.transactionId) ?? "");
			return t && t.categoryId === str(undo.categoryId) ? { ...undo, unverified: true } : null;
		}
		case "register_subscription": {
			const found = await stores.recurrences.get(str(undo.recurrenceId) ?? "");
			return found ? undo : null;
		}
		case "set_budget_limit": {
			const current = (await stores.budgets.list()).find((b) => b.scope === str(undo.scope));
			return current && current.limitCents === undo.limitCents ? { ...undo, unverified: true } : null;
		}
		case "flag_duplicate": {
			const t = await stores.transactions.get(str(undo.transactionId) ?? "");
			return t && t.status === "pending" && !t.editedByOwner ? { ...undo, unverified: true } : null;
		}
		case "create_savings_goal": {
			const found = await stores.goals.get(str(undo.goalId) ?? "");
			return found ? undo : null;
		}
	}
}

/**
 * Planeja e executa o que o agente pode fazer sozinho agora. Nível "Só avisar" não faz nada. Cada ação já vai para o
 * registro, com o motivo e a evidência; o limite por execução é `maxActionsPerRun` das escolhas do dono.
 *
 * Ordem de cada ação: ler e calcular o `undo` → reservar o registro (`applying`, já com o `undo`) → gravar → concluir
 * (`done`). Só se solta a reserva quando se sabe que nada foi gravado; se a gravação falhou no meio (ou o passo final),
 * o registro continua com o `undo` e a próxima passada o resolve (`settleApplying`): a mudança nunca fica sem registro.
 */
export async function runEconomyActions(
	stores: Stores,
	now: () => Date,
	agent: AgentRecord,
	context: { reading: SavingsReading; input?: SavingsInput },
): Promise<EconomyRunResult> {
	const result: EconomyRunResult = { planned: 0, applied: [], skipped: 0, failed: 0 };
	// Resolve o que ficou pendente de uma passada anterior, mesmo que o dono tenha voltado ao "Só avisar".
	await settleApplying(stores, agent);
	if (economySettings(agent).autonomy !== "reversible") return result;
	const today = toLocalDate(now());
	const input = context.input ?? (await loadSavingsInput(stores, today));
	const plan = planAutonomousActions(await gatherInput(stores, agent, today, context.reading, input));
	result.planned = plan.length;

	for (const action of plan) {
		let prepared: Applied;
		try {
			prepared = await prepare(stores, action);
		} catch {
			result.failed += 1;
			continue;
		}
		if (prepared === null) {
			// O dono mudou o que seria tocado: nada foi reservado nem gravado; o achado volta se a situação mudar.
			result.skipped += 1;
			continue;
		}
		const reserved = await stores.agentActivity.reserve(agent.id, {
			kind: action.kind,
			dedupeKey: action.dedupeKey,
			summary: action.summary,
			reason: action.reason,
			evidence: action.evidence,
			undo: prepared.undo,
		});
		if (reserved === null) {
			result.skipped += 1;
			continue;
		}
		try {
			const finalUndo = await execute(stores, action, prepared.undo);
			const saved = await stores.agentActivity.finish(reserved.id, finalUndo);
			result.applied.push(saved ?? reserved);
		} catch {
			// Pode ter gravado: o registro fica `applying`, com o `undo`, e a próxima passada decide.
			result.failed += 1;
		}
	}
	return result;
}

// ------------------------------------------------------------------ desfazer

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** Devolve o estado anterior e, se não deu para mexer (o dono já tinha mudado), o motivo em uma frase. */
async function revert(stores: Stores, kind: AutonomousActionKind, undo: UndoData): Promise<string | null> {
	// Concluída por dedução depois de uma falha: não dá para provar que foi o agente, então nada é desfeito.
	if (undo.unverified === true) return "Não tenho certeza de que fui eu; deixei como está.";
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
			if (
				(undo.name !== undefined && r.name !== undo.name) ||
				(undo.amountCents !== undefined && r.amountCents !== undo.amountCents) ||
				(undo.dayOfMonth !== undefined && r.dayOfMonth !== undo.dayOfMonth)
			) {
				return "Você já tinha mudado essa assinatura; deixei como está.";
			}
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
			if (
				(undo.name !== undefined && goal.name !== undo.name) ||
				(undo.targetCents !== undefined && goal.targetCents !== undo.targetCents)
			) {
				return "Você já tinha mudado essa meta; deixei como está.";
			}
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
	if (found.status === "applying" || found.status === "retry") {
		throw new DataError("invalid", "Esta ação ainda está em andamento. Tente de novo em instantes.");
	}
	if (found.status === "failed") throw new DataError("invalid", "Esta ação não chegou a ser feita.");
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
