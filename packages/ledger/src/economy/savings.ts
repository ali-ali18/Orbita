import type { SavingsReading } from "@orbita/agents";
import {
	addMonths,
	DEFAULT_AUTONOMY,
	findSavingsOpportunities,
	type LocalDate,
	monthOf,
	type SavingsInput,
	type SavingsSpend,
	toLocalDate,
	withoutKeys,
} from "@orbita/core";
import type { AgentRecord, Stores } from "@orbita/db";
import { agentSettingsSchemas, BUILTIN_AGENTS, type EconomiaSettings } from "@orbita/shared";
import { incomeOverview } from "../income.ts";
import { invoicesOverview } from "../invoices-overview.ts";
import { activeInstallments, categoryForSummary, countsAsSpending, monthSummary } from "../summary.ts";

/*
 * Junta as stores e o engine de oportunidades (`findSavingsOpportunities`, em `@orbita/core`): lê o que as telas já
 * leem (gasto do mês, projeção, faturas, parcelas, renda) e entrega os achados já sem o que o dono ignorou. A API
 * (tela "Onde cortar"), o worker (agente Economia) e a ferramenta do chat usam esta mesma leitura.
 */

/** Meses fechados da média (3) mais o corrente: o histórico mínimo que o motor precisa. */
const HISTORY_MONTHS = 3;

/** Escolhas do Economia: as salvas valem; o que faltar ou estiver inválido volta ao padrão do catálogo. */
export function economySettings(agent: Pick<AgentRecord, "settings"> | null): EconomiaSettings {
	const defaults = BUILTIN_AGENTS.economia.defaultSettings;
	const merged = agentSettingsSchemas.economia.safeParse({ ...defaults, ...(agent?.settings ?? {}) });
	return merged.success ? merged.data : agentSettingsSchemas.economia.parse(defaults);
}

export async function findEconomyAgent(stores: Stores): Promise<AgentRecord | null> {
	return (await stores.agents.list()).find((a) => a.builtinKey === "economia") ?? null;
}

/** Tudo o que o motor lê, vindo das stores (sem tirar o que o dono ignorou). */
export async function loadSavingsInput(stores: Stores, today: LocalDate): Promise<SavingsInput> {
	const month = monthOf(today);
	const [categories, recurrences, summary, income, overview, installmentGroups, accounts] = await Promise.all(
		[
			stores.categories.list(),
			stores.recurrences.list(),
			monthSummary(stores, month, today),
			incomeOverview(stores, today),
			invoicesOverview(stores, today),
			activeInstallments(stores, month, today),
			stores.accounts.list(),
		],
	);
	const active = categories.filter((c) => c.archivedAt === null);
	const slugOf = new Map(categories.map((c) => [c.id, c.slug]));
	const bySlug = new Map(active.map((c) => [c.slug, c.id]));
	const outrosId = bySlug.get("outros") ?? null;

	const months = Array.from({ length: HISTORY_MONTHS + 1 }, (_, i) => addMonths(month, -i));
	const from = `${addMonths(month, -HISTORY_MONTHS)}-01`;
	const [perMonth, postings] = await Promise.all([
		Promise.all(months.map((m) => stores.transactions.listByBudgetMonth(m))),
		Promise.all(months.map((m) => stores.recurrences.listPostings(m))),
	]);
	const spends: SavingsSpend[] = perMonth
		.flat()
		.filter((t) => t.kind === "expense" && countsAsSpending(t) && t.date >= from && t.date <= today)
		.map((t) => {
			const categoryId = categoryForSummary(t, outrosId, bySlug);
			return {
				id: t.id,
				date: t.date,
				amountCents: t.amountCents,
				categoryId,
				categorySlug: categoryId === null ? null : (slugOf.get(categoryId) ?? null),
				merchant: t.merchantName ?? t.description,
				// A descrição guarda o texto cru do banco ("GOOGLE *YouTubeMusic") quando o nome é só "Google".
				...(t.merchantName && t.description !== t.merchantName
					? { brandText: `${t.merchantName} ${t.description}` }
					: {}),
				installmentGroupId: t.installmentGroupId,
			};
		});

	// Parcelas vigentes no mês: o que o engine de parcelamentos diz que vence agora (não se recalcula aqui).
	const committed = installmentGroupMonth(installmentGroups, month);

	const balances = accounts.filter(
		(a) => a.archivedAt === null && a.kind === "checking" && a.balanceCents !== null,
	);
	const total = summary.budgets.find((b) => b.scope === "total");
	return {
		today,
		spends,
		subscriptions: recurrences
			.filter((r) => r.kind === "expense")
			.map((r) => ({
				id: r.id,
				name: r.name,
				amountCents: r.amountCents,
				remindDayBefore: r.remindDayBefore,
			})),
		postedIds: new Set(postings.flat().map((p) => p.transactionId)),
		incomeCents: income.monthIncomeCents > 0 ? income.monthIncomeCents : null,
		totalBudgetCents: total?.limitCents ?? null,
		projectedCents: summary.projection?.projectedCents ?? null,
		projectionLowConfidence: summary.projection?.lowConfidence ?? false,
		installments: committed,
		invoices: overview.cards.map((line) => ({
			cardId: line.card.id,
			cardName: line.card.name,
			dueDate: line.due.dueDate,
			owedCents: line.due.owedCents,
		})),
		balanceCents: balances.length === 0 ? null : balances.reduce((sum, a) => sum + (a.balanceCents ?? 0), 0),
	};
}

function installmentGroupMonth(
	groups: Awaited<ReturnType<typeof activeInstallments>>,
	month: string,
): SavingsInput["installments"] {
	let committedCents = 0;
	let groupCount = 0;
	const transactionIds: string[] = [];
	for (const g of groups) {
		if (g.committedMonthCents <= 0) continue;
		committedCents += g.committedMonthCents;
		groupCount += 1;
		for (const t of g.installments)
			if ((t.invoiceMonth ?? t.budgetMonth) === month) transactionIds.push(t.id);
	}
	return { committedCents, transactionIds, groupCount };
}

/** A leitura completa de "Onde cortar": achados sem os ignorados, mais o que a tela e a ferramenta precisam. */
export async function savingsOpportunities(stores: Stores, now: () => Date): Promise<SavingsReading> {
	const today = toLocalDate(now());
	const [input, agent, categories, budgets] = await Promise.all([
		loadSavingsInput(stores, today),
		findEconomyAgent(stores),
		stores.categories.list(),
		stores.budgets.list(),
	]);
	const settings = economySettings(agent);
	const result = withoutKeys(findSavingsOpportunities(input), new Set(settings.ignored));
	return {
		month: monthOf(today),
		result,
		categoryNames: Object.fromEntries(categories.map((c) => [c.id, c.name])),
		remindingSubscriptionIds: input.subscriptions.filter((s) => s.remindDayBefore).map((s) => s.id),
		limitedCategoryIds: budgets.filter((b) => b.scope !== "total").map((b) => b.scope),
		autonomy: settings.autonomy ?? DEFAULT_AUTONOMY,
	};
}
