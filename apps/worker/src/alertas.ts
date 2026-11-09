import {
	type AlertCandidate,
	type ChatModelConfig,
	collectAlerts,
	costMicroUsd,
	isMainModel,
	type ModelClient,
	resolveChatModels,
	runCustomAgent,
	wordAlerts,
} from "@orbita/agents";
import { invoiceClosedSince, isDue, latestOccurrence, monthOf, toLocalDate } from "@orbita/core";
import type { AgentRecord, Stores } from "@orbita/db";
import { budgetBlock, createAgentReader, economySettings, runEconomyActions } from "@orbita/ledger";
import { builtinAgentSeeds } from "@orbita/shared";
import { createFindingsPort } from "./alertas-port.ts";

/*
 * Roda os agentes ligados na agenda deles e grava os avisos. Quem DECIDE se há aviso é o engine
 * (`collectAlerts`, determinístico); a IA só reescreve o texto, quando há chave e o gasto do mês deixa. Sem chave
 * ou acima do limite, os avisos aparecem do mesmo jeito, com o texto-modelo. Idempotente: cada achado tem uma
 * chave e o par (agente, chave) é único, então rodar de novo no mesmo período não duplica nada.
 */

export const ALERTS_QUEUE = "alertas";
export const RUN_AGENTS_JOB = "rodar-agentes";
/** A cada hora cheia, em São Paulo: as agendas são em horas cheias. */
export const RUN_AGENTS_PATTERN = "0 * * * *";
export const RUN_AGENTS_TIME_ZONE = "America/Sao_Paulo";

export interface RunAgentsDeps {
	stores: Stores;
	now: () => Date;
	/** Abre a chave da Anthropic do cofre (`null` se não existe). Lança se não consegue abrir. */
	readApiKey(): Promise<string | null>;
	/** Cria o cliente do modelo (os testes injetam um falso). */
	createClient(apiKey: string): ModelClient;
	/** Modelos padrão do servidor (o que o dono escolheu no app vence). */
	models: ChatModelConfig;
	/** `false` desliga a reescrita por IA dos agentes da casa (os agentes do dono continuam precisando dela). */
	aiWording: boolean;
	log(line: string): void;
}

export interface RunAgentsResult {
	/** Agentes que rodaram nesta passada. */
	ran: number;
	/** Avisos novos gravados. */
	created: number;
	/** Dos novos, quantos a IA reescreveu. */
	worded: number;
	/** Ações que o agente Economia fez sozinho (nível "Agir no que é reversível"); ficam no registro de atividades. */
	actions: number;
	/** Agentes que falharam (seguem para a próxima passada). */
	failed: number;
}

const scheduleOf = (a: AgentRecord) => ({ frequency: a.frequency, hour: a.runHour, day: a.runDay });

export async function runDueAgents(deps: RunAgentsDeps): Promise<RunAgentsResult> {
	const { stores } = deps;
	await stores.agents.ensureBuiltins(builtinAgentSeeds());
	const now = deps.now();
	// Dias de fechamento dos cartões ativos: o Economia também roda no dia seguinte ao fechamento de uma fatura.
	const closingDays = (await stores.cards.list())
		.filter((c) => c.archivedAt === null)
		.map((c) => c.closingDay);
	const due = (await stores.agents.list()).filter(
		// A Órbita é só a conversa: não tem avisos próprios.
		(a) =>
			a.enabled &&
			a.builtinKey !== "orbita" &&
			(isDue(scheduleOf(a), a.lastRunAt, now) ||
				(a.builtinKey === "economia" &&
					economySettings(a).onInvoiceClose &&
					invoiceClosedSince(closingDays, a.lastRunAt, now))),
	);
	const result: RunAgentsResult = { ran: 0, created: 0, worded: 0, failed: 0, actions: 0 };
	if (due.length === 0) return result;

	const port = await createFindingsPort(stores, deps.now);
	const models = resolveChatModels(deps.models, await stores.aiUsage.getModelChoice());
	let clientPromise: Promise<ModelClient | null> | undefined;
	// A chave só é aberta se alguém precisar de IA nesta passada; sem chave ou ilegível, é `null`.
	const getClient = () => {
		clientPromise ??= (async () => {
			try {
				const key = await deps.readApiKey();
				return key === null ? null : deps.createClient(key);
			} catch {
				return null;
			}
		})();
		return clientPromise;
	};
	const guard = () => budgetBlock({ stores, now: deps.now });
	const recordUsage = async (entry: { model: string; usage: Parameters<typeof costMicroUsd>[1] }) => {
		await stores.aiUsage.record({
			conversationId: null,
			model: entry.model,
			...entry.usage,
			costMicroUsd: costMicroUsd(entry.model, entry.usage),
			at: deps.now(),
		});
	};
	const modelFor = (agent: AgentRecord, fallback: string) =>
		agent.model !== null && isMainModel(agent.model) ? agent.model : fallback;

	for (const agent of due) {
		try {
			let candidates: AlertCandidate[] = [];
			if (agent.builtinKey === "economia") {
				// Primeiro age, no que o dono deixou (nível "Só avisar" não faz nada), e só depois avisa.
				const acted = await runEconomyActions(stores, deps.now, agent, { reading: await port.savings() });
				result.actions += acted.applied.length;
				if (acted.failed > 0) deps.log(`[agentes] ${agent.name}: ${acted.failed} ação(ões) falharam`);
			}
			if (agent.builtinKey !== null) {
				candidates = await collectAlerts({ builtinKey: agent.builtinKey, settings: agent.settings }, port);
			} else {
				const client = await getClient();
				// Agente do dono só existe com IA: sem chave ou acima do limite, espera a próxima passada.
				if (!client || (await guard())) continue;
				const today = toLocalDate(now);
				const run = await runCustomAgent(
					{
						client,
						toolContext: customToolContext(stores, deps.now),
						recordUsage,
						guard,
						onToolError: (name, error) => deps.log(`[agentes] ferramenta ${name} falhou: ${String(error)}`),
					},
					{
						agent,
						context: {
							today,
							month: monthOf(today),
							ownerName: (await stores.preferences.get()).displayName,
						},
						model: modelFor(agent, models.main),
						effort: models.effort,
						period: latestOccurrence(scheduleOf(agent), now).period,
					},
				);
				// Parou no meio (limite, recusa): não marca como rodado, tenta de novo.
				if (run.stop === "blocked") continue;
				candidates = run.alert ? [run.alert] : [];
			}

			const created = await stores.agents.addAlerts(agent.id, candidates);
			result.created += created.length;
			if (agent.builtinKey !== null && deps.aiWording && created.length > 0) {
				result.worded += await rewrite(agent, created, {
					getClient,
					guard,
					recordUsage,
					model: modelFor(agent, models.fast ?? models.main),
					stores,
				});
			}
			await stores.agents.markRun(agent.id, deps.now());
			result.ran += 1;
		} catch (error) {
			result.failed += 1;
			deps.log(`[agentes] ${agent.name} falhou: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return result;
}

function customToolContext(stores: Stores, now: () => Date) {
	const reader = createAgentReader(stores, now);
	const today = toLocalDate(now());
	let catalog: ReturnType<typeof reader.catalog> | undefined;
	return {
		today,
		currentMonth: monthOf(today),
		reader,
		catalog: () => {
			catalog ??= reader.catalog();
			return catalog;
		},
	};
}

/** Pede à IA o texto melhor dos avisos novos; devolve quantos foram reescritos. Qualquer falha deixa o modelo. */
async function rewrite(
	_agent: AgentRecord,
	created: Array<{ id: string; body: string }>,
	ctx: {
		getClient: () => Promise<ModelClient | null>;
		guard: () => Promise<string | null>;
		recordUsage: Parameters<typeof wordAlerts>[0]["recordUsage"];
		model: string;
		stores: Stores;
	},
): Promise<number> {
	const client = await ctx.getClient();
	if (!client) return 0;
	const { texts } = await wordAlerts(
		{ client, model: ctx.model, recordUsage: ctx.recordUsage, guard: ctx.guard },
		created.map((a) => a.body),
	);
	let worded = 0;
	for (const [i, text] of texts.entries()) {
		const alert = created[i];
		if (text === null || !alert) continue;
		await ctx.stores.agents.setAlertBody(alert.id, text, true);
		worded += 1;
	}
	return worded;
}
