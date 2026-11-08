import { type LocalDate, monthOf } from "@orbita/core";
import { DataError, type Stores } from "@orbita/db";
import { pickCategoryRule, type SetupApplyInput, type SetupUndo } from "@orbita/shared";
import { applyIncomePlan, restoreBudgets } from "./income-plan.ts";
import { loadSetupAnalysis, verifyAgainstAnalysis } from "./setup.ts";

/*
 * Aplica e desfaz a configuração que o dono confirmou, numa operação só. As stores não têm transação que cruze
 * recorrências, regras, lançamentos, renda e orçamento, então cada passo anota o que fez (`SetupUndo`) e, se um passo
 * falha, os anteriores são revertidos na hora (desfazer compensatório) e o erro sobe: ou entra tudo ou nada.
 * O mesmo `undoSetup` serve ao "Desfazer" do card.
 */

/** Só despesa e estorno mudam de categoria por regra (como em `createCategoryRule`). */
const RULE_KINDS = new Set(["expense", "refund"]);

const emptyUndo = (): SetupUndo => ({
	recurrenceIds: [],
	rules: [],
	recategorized: [],
	incomeId: null,
	previousBudgets: null,
});

export async function applySetup(
	stores: Stores,
	input: SetupApplyInput,
	today: LocalDate,
): Promise<SetupUndo> {
	// Os números da proposta têm que bater com o histórico de agora (nada de confiar no que o modelo escreveu).
	const verified = verifyAgainstAnalysis(await loadSetupAnalysis(stores, today), input);
	const checked = await checkReferences(stores, verified);

	const undo = emptyUndo();
	try {
		for (const s of checked.subscriptions) {
			const created = await stores.recurrences.create({
				kind: "expense",
				name: s.name,
				amountCents: s.amountCents,
				dayOfMonth: s.dayOfMonth,
				startDate: s.startDate,
				categoryId: s.categoryId,
				accountId: s.cardId ? null : s.accountId,
				cardId: s.cardId,
			});
			undo.recurrenceIds.push(created.id);
		}

		const existing = new Map((await stores.categoryRules.list()).map((r) => [r.pattern, r]));
		for (const r of checked.categoryRules) {
			const before = existing.get(r.pattern);
			const rule = await stores.categoryRules.upsert(r.pattern, r.categoryId);
			undo.rules.push({
				ruleId: rule.id,
				pattern: r.pattern,
				created: before === undefined,
				previousCategoryId: before?.categoryId ?? null,
			});
		}

		// Recategoriza o passado só depois de TODAS as regras gravadas: a mais específica continua mandando.
		const retro = new Set(checked.categoryRules.filter((r) => r.applyToExisting).map((r) => r.pattern));
		if (retro.size > 0) {
			const rules = await stores.categoryRules.list();
			const ours = new Map(rules.filter((r) => retro.has(r.pattern)).map((r) => [r.id, r]));
			for (const t of await stores.transactions.listCategoryNotEditedByOwner()) {
				if (!RULE_KINDS.has(t.kind)) continue;
				const rule = pickCategoryRule(rules, t.merchantName, t.description);
				if (!rule || !ours.has(rule.id) || t.categoryId === rule.categoryId) continue;
				await stores.transactions.update(t.id, { categoryId: rule.categoryId });
				undo.recategorized.push({
					transactionId: t.id,
					previousCategoryId: t.categoryId,
					categoryId: rule.categoryId,
				});
			}
		}

		if (checked.income) {
			const created = await stores.incomeSources.create({
				name: checked.income.name,
				amountCents: checked.income.amountCents,
				payday: checked.income.payday,
				accountId: checked.income.accountId,
				recurring: true,
			});
			undo.incomeId = created.id;
		}

		// O plano por último: ele lê as assinaturas e a renda que acabaram de ser criadas.
		if (checked.plan) {
			const { previous } = await applyIncomePlan(stores, monthOf(today), today, {
				reservePercent: checked.plan.reservePercent,
				confirm: true,
			});
			undo.previousBudgets = previous;
		}
		return undo;
	} catch (error) {
		await undoSetup(stores, undo).catch(() => undefined);
		throw error;
	}
}

/** Contas, cartões e categorias ainda ativos: erro claro antes de gravar qualquer coisa. */
async function checkReferences(stores: Stores, input: SetupApplyInput): Promise<SetupApplyInput> {
	const [categories, accounts, cards] = await Promise.all([
		stores.categories.list(),
		stores.accounts.list(),
		stores.cards.list(),
	]);
	const activeCategories = new Set(categories.filter((c) => c.archivedAt === null).map((c) => c.id));
	const activeAccounts = new Set(accounts.filter((a) => a.archivedAt === null).map((a) => a.id));
	const activeCards = new Set(cards.filter((c) => c.archivedAt === null).map((c) => c.id));
	for (const s of input.subscriptions) {
		if (!activeCategories.has(s.categoryId)) {
			throw new DataError("bad_reference", `A categoria de "${s.name}" não existe mais. Escolha outra.`);
		}
		const place = s.cardId
			? activeCards.has(s.cardId)
			: s.accountId
				? activeAccounts.has(s.accountId)
				: false;
		if (!place) {
			throw new DataError(
				"bad_reference",
				`A conta ou o cartão de "${s.name}" não está mais ativo. Desmarque essa assinatura.`,
			);
		}
	}
	for (const r of input.categoryRules) {
		if (!activeCategories.has(r.categoryId)) {
			throw new DataError("bad_reference", "Uma das categorias escolhidas não existe mais. Escolha outra.");
		}
	}
	// A conta da renda é só informação: conta arquivada não derruba a configuração.
	if (input.income?.accountId && !activeAccounts.has(input.income.accountId)) {
		return { ...input, income: { ...input.income, accountId: null } };
	}
	return input;
}

const ignoreMissing = async (run: () => Promise<unknown>) => {
	try {
		await run();
	} catch (error) {
		if (error instanceof DataError && error.code === "not_found") return;
		throw error;
	}
};

/**
 * Reverte `applySetup`, do último passo para o primeiro. Repetir não falha: o que já sumiu ou já foi desfeito é
 * ignorado. Não passa por cima de mudança do dono depois: o lançamento só volta se ainda tem a categoria que a regra
 * deu e não foi editado à mão.
 */
export async function undoSetup(stores: Stores, undo: SetupUndo): Promise<void> {
	if (undo.previousBudgets) await restoreBudgets(stores, undo.previousBudgets);
	if (undo.incomeId) {
		const id = undo.incomeId;
		await ignoreMissing(() => stores.incomeSources.archive(id));
	}
	for (const r of undo.recategorized) {
		const current = await stores.transactions.get(r.transactionId);
		if (!current || current.categoryEditedByOwner || current.categoryId !== r.categoryId) continue;
		await stores.transactions.update(r.transactionId, { categoryId: r.previousCategoryId });
	}
	for (const r of undo.rules) {
		if (r.created) {
			await stores.categoryRules.delete(r.ruleId);
			continue;
		}
		const current = await stores.categoryRules.get(r.ruleId);
		if (current && r.previousCategoryId && current.categoryId !== r.previousCategoryId) {
			await stores.categoryRules.upsert(r.pattern, r.previousCategoryId);
		}
	}
	for (const id of undo.recurrenceIds) await ignoreMissing(() => stores.recurrences.archive(id));
}
