import { isMainModel } from "@orbita/agents";
import { type AgentPatch, type AgentRecord, type AlertRecord, DataError, type Stores } from "@orbita/db";
import {
	type AgentDto,
	type AgentUpdateBody,
	type AlertDto,
	agentSettingsSchemas,
	BUILTIN_AGENTS,
	builtinAgentSeeds,
} from "@orbita/shared";

/** O que o dono vê do agente, junto com o aviso mais recente e quantos avisos novos há. */
const TAGLINE_MAX = 90;

export function toAlertDto(alert: AlertRecord, agentName: string): AlertDto {
	return {
		id: alert.id,
		agentId: alert.agentId,
		agentName,
		kind: alert.kind,
		title: alert.title,
		body: alert.body,
		wordedByAi: alert.wordedByAi,
		status: alert.status,
		transactionId: alert.transactionId,
		proposalId: alert.proposalId,
		createdAt: alert.createdAt.toISOString(),
	};
}

export function toAgentDto(
	agent: AgentRecord,
	extra: { alertsNew: number; latestAlert: AlertRecord | null },
): AgentDto {
	const info = agent.builtinKey === null ? null : BUILTIN_AGENTS[agent.builtinKey];
	const instructions = agent.instructions ?? "";
	return {
		id: agent.id,
		builtinKey: agent.builtinKey,
		name: agent.name,
		tagline:
			info?.tagline ??
			(instructions.length > TAGLINE_MAX
				? `${instructions.slice(0, TAGLINE_MAX - 1).trimEnd()}…`
				: instructions),
		watches: info ? [...info.watches] : [],
		instructions: agent.instructions,
		tools: agent.tools,
		enabled: agent.enabled,
		alwaysOn: info?.alwaysOn ?? false,
		schedule: { frequency: agent.frequency, hour: agent.runHour, day: agent.runDay },
		// O que falta nas escolhas salvas vale o padrão do catálogo: o app sempre recebe o conjunto completo.
		settings: info ? { ...info.defaultSettings, ...agent.settings } : {},
		model: agent.model,
		lastRunAt: agent.lastRunAt?.toISOString() ?? null,
		alertsNew: extra.alertsNew,
		latestAlert: extra.latestAlert ? toAlertDto(extra.latestAlert, agent.name) : null,
	};
}

/** Garante os agentes da casa e devolve todos, com o resumo de avisos de cada um. */
export async function listAgents(stores: Stores): Promise<AgentDto[]> {
	await stores.agents.ensureBuiltins(builtinAgentSeeds());
	const [agents, counts, latest] = await Promise.all([
		stores.agents.list(),
		stores.agents.countNewByAgent(),
		// Os mais recentes de qualquer agente: 100 cobrem o "último aviso" de cada um na prática.
		stores.agents.listAlerts({ limit: 100 }),
	]);
	const latestBy = new Map<string, AlertRecord>();
	for (const alert of latest) if (!latestBy.has(alert.agentId)) latestBy.set(alert.agentId, alert);
	return agents.map((a) =>
		toAgentDto(a, { alertsNew: counts[a.id] ?? 0, latestAlert: latestBy.get(a.id) ?? null }),
	);
}

export async function agentDetail(
	stores: Stores,
	id: string,
): Promise<{ agent: AgentDto; alerts: AlertDto[] } | null> {
	await stores.agents.ensureBuiltins(builtinAgentSeeds());
	const agent = await stores.agents.get(id);
	if (!agent) return null;
	const [counts, alerts] = await Promise.all([
		stores.agents.countNewByAgent(),
		// Os dispensados não voltam à tela do agente.
		stores.agents.listAlerts({ agentId: id, limit: 50 }),
	]);
	const shown = alerts.filter((a) => a.status !== "dismissed").slice(0, 20);
	return {
		agent: toAgentDto(agent, { alertsNew: counts[id] ?? 0, latestAlert: shown[0] ?? null }),
		alerts: shown.map((a) => toAlertDto(a, agent.name)),
	};
}

/**
 * Traduz o PATCH em mudança do store, com as regras que o banco não sabe: a Órbita não desliga, as escolhas de um
 * agente da casa passam pelo schema dele (estrito, depois de juntar com as atuais), o modelo só vale se estiver na
 * lista permitida, e o agente do dono não tem "escolhas".
 */
export function buildPatch(agent: AgentRecord, body: AgentUpdateBody): AgentPatch {
	const patch: AgentPatch = {};
	if (body.enabled !== undefined) {
		if (agent.builtinKey === "orbita" && !body.enabled) {
			throw new DataError("invalid", "A Órbita está sempre ativa.");
		}
		patch.enabled = body.enabled;
	}
	if (body.model !== undefined) {
		if (body.model !== null && !isMainModel(body.model)) {
			throw new DataError("invalid", "Esse modelo não está na lista permitida.");
		}
		patch.model = body.model;
	}
	if (body.schedule) {
		patch.frequency = body.schedule.frequency;
		patch.runHour = body.schedule.hour;
		patch.runDay = body.schedule.day;
	}
	if (body.settings !== undefined) {
		if (agent.builtinKey === null)
			throw new DataError("invalid", "Agente criado por você não tem escolhas para ajustar.");
		const info = BUILTIN_AGENTS[agent.builtinKey];
		const merged = agentSettingsSchemas[agent.builtinKey].safeParse({
			...info.defaultSettings,
			...agent.settings,
			...body.settings,
		});
		if (!merged.success) {
			throw new DataError("invalid", merged.error.issues[0]?.message ?? "Escolhas inválidas.");
		}
		patch.settings = merged.data as Record<string, unknown>;
	}
	if (body.name !== undefined) patch.name = body.name;
	if (body.instructions !== undefined) patch.instructions = body.instructions;
	if (body.tools !== undefined) patch.tools = body.tools;
	return patch;
}
