import {
	OPPORTUNITY_ACTION_LABEL,
	opportunityActions,
	opportunityText,
	type SavingsReading,
} from "@orbita/agents";
import type { ActivityRecord, Stores } from "@orbita/db";
import { DataError } from "@orbita/db";
import { economySettings, findEconomyAgent, savingsOpportunities } from "@orbita/ledger";
import {
	type ActivityDto,
	builtinAgentSeeds,
	type SavingsActBody,
	type SavingsListResponse,
} from "@orbita/shared";

/** O agente Economia (criado na primeira leitura, como os outros da casa). */
export async function needEconomyAgent(stores: Stores) {
	await stores.agents.ensureBuiltins(builtinAgentSeeds());
	return (await findEconomyAgent(stores)) as NonNullable<Awaited<ReturnType<typeof findEconomyAgent>>>;
}

export function toSavingsList(
	reading: SavingsReading,
	agent: { id: string; enabled: boolean } | null,
): SavingsListResponse {
	const categoryName = (id: string) => reading.categoryNames[id] ?? "Sem categoria";
	const state = {
		remindingSubscriptionIds: new Set(reading.remindingSubscriptionIds),
		limitedCategoryIds: new Set(reading.limitedCategoryIds),
	};
	return {
		month: reading.month,
		totalMonthlySavingsCents: reading.result.totalMonthlySavingsCents,
		autonomy: reading.autonomy,
		agentId: agent?.id ?? null,
		agentEnabled: agent?.enabled ?? false,
		opportunities: reading.result.opportunities.map((o) => {
			const text = opportunityText(o, categoryName);
			return {
				key: o.key,
				type: o.type,
				title: text.title,
				body: text.body,
				monthlySavingsCents: o.monthlySavingsCents,
				confidence: o.confidence,
				countsInTotal: o.countsInTotal,
				evidenceTransactionIds: o.evidence.transactionIds,
				actions: opportunityActions(o, state).map((id) => ({ id, label: OPPORTUNITY_ACTION_LABEL[id] })),
			};
		}),
	};
}

export async function loadSavingsList(stores: Stores, now: () => Date): Promise<SavingsListResponse> {
	const agent = await needEconomyAgent(stores);
	return toSavingsList(await savingsOpportunities(stores, now), agent);
}

/** Quantos "ignorados" se guardam: passando disso, os mais antigos saem (o achado reaparece só se ainda existir). */
export const IGNORED_MAX = 200;

export async function ignoreOpportunity(stores: Stores, key: string): Promise<void> {
	const agent = await needEconomyAgent(stores);
	const settings = economySettings(agent);
	if (settings.ignored.includes(key)) return;
	const ignored = [...settings.ignored, key].slice(-IGNORED_MAX);
	await stores.agents.update(agent.id, { settings: { ...settings, ignored } });
}

/**
 * Ação de um toque do dono sobre um achado. O servidor refaz a leitura e só age se o achado ainda existe e a ação
 * ainda cabe nele: nada vem do app além da chave e do nome da ação. Reversíveis e sem apagar nada.
 */
export async function actOnOpportunity(stores: Stores, now: () => Date, body: SavingsActBody): Promise<void> {
	const reading = await savingsOpportunities(stores, now);
	const found = reading.result.opportunities.find((o) => o.key === body.key);
	if (!found) throw new DataError("not_found", "Esse achado não existe mais. Atualize a lista.");
	const allowed = opportunityActions(found, {
		remindingSubscriptionIds: new Set(reading.remindingSubscriptionIds),
		limitedCategoryIds: new Set(reading.limitedCategoryIds),
	});
	if (!(allowed as string[]).includes(body.action)) {
		throw new DataError("invalid", "Essa ação não vale para este achado.");
	}
	if (body.action === "cancel_reminder") {
		for (const id of found.evidence.subscriptionIds) {
			if (reading.remindingSubscriptionIds.includes(id)) {
				await stores.recurrences.update(id, { remindDayBefore: false });
			}
		}
		return;
	}
	if (found.type === "category_above_average") {
		await stores.budgets.set(found.detail.categoryId, found.detail.suggestedLimitCents);
	}
}

export function toActivityDto(a: ActivityRecord): ActivityDto {
	return {
		id: a.id,
		kind: a.kind,
		summary: a.summary,
		reason: a.reason,
		evidenceTransactionIds: a.evidence.transactionIds,
		status: a.status,
		createdAt: a.createdAt.toISOString(),
		undoneAt: a.undoneAt?.toISOString() ?? null,
		undoNote: a.undoNote,
		canUndo: a.status === "done",
	};
}
