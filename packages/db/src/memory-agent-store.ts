import { randomUUID } from "node:crypto";
import { BUILTIN_AGENT_KEYS } from "@orbita/shared";
import {
	BUILTIN_LOCKED_MESSAGE,
	BUILTIN_UNDELETABLE_MESSAGE,
	cleanAgentInstructions,
	cleanAgentName,
	cleanAgentTools,
	cleanAlertBody,
	cleanAlertDraft,
	cleanModel,
	cleanSchedule,
} from "./agent-rules.ts";
import type { AgentRecord, AgentStore, AlertRecord } from "./agent-store.ts";
import { badReference, invalid, notFound } from "./errors.ts";
import type { MemoryState } from "./memory-state.ts";

/** Ordem da lista: os da casa na ordem do catálogo, depois os do dono do mais antigo ao mais novo. */
export function compareAgents(a: AgentRecord, b: AgentRecord): number {
	const rank = (r: AgentRecord) =>
		r.builtinKey === null ? Number.MAX_SAFE_INTEGER : BUILTIN_AGENT_KEYS.indexOf(r.builtinKey);
	return rank(a) - rank(b) || a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1);
}

export const compareAlertsNewestFirst = (a: AlertRecord, b: AlertRecord): number =>
	b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1);

const copyAgent = (r: AgentRecord): AgentRecord => ({
	...r,
	tools: [...r.tools],
	settings: structuredClone(r.settings),
});
const copyAlert = (r: AlertRecord): AlertRecord => ({ ...r, data: structuredClone(r.data) });

/** Implementação em memória, para testes. Segue as mesmas regras da versão Prisma. */
export function createMemoryAgentStore(state: MemoryState): AgentStore {
	const need = (id: string): AgentRecord => {
		const found = state.agents.get(id);
		if (!found) throw notFound("Agente", "o");
		return found;
	};
	return {
		async ensureBuiltins(seeds) {
			for (const seed of seeds) {
				const exists = [...state.agents.values()].some((a) => a.builtinKey === seed.builtinKey);
				if (exists) continue;
				const at = state.now();
				const schedule = cleanSchedule(seed);
				const id = randomUUID();
				state.agents.set(id, {
					id,
					builtinKey: seed.builtinKey,
					name: cleanAgentName(seed.name),
					instructions: null,
					tools: [],
					enabled: seed.enabled,
					...schedule,
					settings: structuredClone(seed.settings),
					model: null,
					lastRunAt: null,
					createdAt: at,
					updatedAt: at,
				});
			}
		},
		async list() {
			return [...state.agents.values()].sort(compareAgents).map(copyAgent);
		},
		async get(id) {
			const found = state.agents.get(id);
			return found ? copyAgent(found) : null;
		},
		async createCustom(input) {
			const schedule = cleanSchedule(input);
			const at = state.now();
			const record: AgentRecord = {
				id: randomUUID(),
				builtinKey: null,
				name: cleanAgentName(input.name),
				instructions: cleanAgentInstructions(input.instructions),
				tools: cleanAgentTools(input.tools),
				enabled: true,
				...schedule,
				settings: {},
				model: null,
				lastRunAt: null,
				createdAt: at,
				updatedAt: at,
			};
			state.agents.set(record.id, record);
			return copyAgent(record);
		},
		async update(id, patch) {
			const current = need(id);
			const ownerOnly =
				patch.name !== undefined || patch.instructions !== undefined || patch.tools !== undefined;
			if (ownerOnly && current.builtinKey !== null) throw invalid(BUILTIN_LOCKED_MESSAGE);
			const schedule = cleanSchedule({
				frequency: patch.frequency ?? current.frequency,
				runHour: patch.runHour ?? current.runHour,
				runDay:
					patch.runDay !== undefined ? patch.runDay : patch.frequency !== undefined ? null : current.runDay,
			});
			const record: AgentRecord = {
				...current,
				name: patch.name !== undefined ? cleanAgentName(patch.name) : current.name,
				instructions:
					patch.instructions !== undefined
						? cleanAgentInstructions(patch.instructions)
						: current.instructions,
				tools: patch.tools !== undefined ? cleanAgentTools(patch.tools) : current.tools,
				enabled: patch.enabled ?? current.enabled,
				...schedule,
				settings: patch.settings !== undefined ? structuredClone(patch.settings) : current.settings,
				model: patch.model !== undefined ? cleanModel(patch.model) : current.model,
				updatedAt: state.now(),
			};
			state.agents.set(id, record);
			return copyAgent(record);
		},
		async deleteCustom(id) {
			const current = state.agents.get(id);
			if (!current) return false;
			if (current.builtinKey !== null) throw invalid(BUILTIN_UNDELETABLE_MESSAGE);
			state.agents.delete(id);
			for (const alert of [...state.alerts.values()]) if (alert.agentId === id) state.alerts.delete(alert.id);
			return true;
		},
		async markRun(id, at) {
			const current = need(id);
			state.agents.set(id, { ...current, lastRunAt: at });
		},

		async addAlerts(agentId, drafts) {
			need(agentId);
			const created: AlertRecord[] = [];
			for (const raw of drafts) {
				const draft = cleanAlertDraft(raw);
				if ([...state.alerts.values()].some((a) => a.agentId === agentId && a.dedupeKey === draft.dedupeKey))
					continue;
				if (draft.transactionId !== null && !state.transactions.has(draft.transactionId))
					throw badReference();
				const record: AlertRecord = {
					id: randomUUID(),
					agentId,
					...draft,
					wordedByAi: false,
					status: "new",
					createdAt: state.now(),
					seenAt: null,
					dismissedAt: null,
				};
				state.alerts.set(record.id, record);
				created.push(copyAlert(record));
			}
			return created;
		},
		async listAlerts(query = {}) {
			const limit = Math.min(Math.max(query.limit ?? 30, 1), 100);
			return [...state.alerts.values()]
				.filter(
					(a) =>
						(query.status === undefined || a.status === query.status) &&
						(query.agentId === undefined || a.agentId === query.agentId),
				)
				.sort(compareAlertsNewestFirst)
				.slice(0, limit)
				.map(copyAlert);
		},
		async getAlert(id) {
			const found = state.alerts.get(id);
			return found ? copyAlert(found) : null;
		},
		async setAlertStatus(id, status) {
			const current = state.alerts.get(id);
			if (!current) return null;
			const at = state.now();
			let next = current;
			if (status === "seen" && current.status === "new") next = { ...current, status: "seen", seenAt: at };
			if (status === "dismissed" && current.status !== "dismissed") {
				next = { ...current, status: "dismissed", dismissedAt: at };
			}
			state.alerts.set(id, next);
			return copyAlert(next);
		},
		async setAlertBody(id, body, wordedByAi) {
			const current = state.alerts.get(id);
			if (!current) return null;
			const next = { ...current, body: cleanAlertBody(body), wordedByAi };
			state.alerts.set(id, next);
			return copyAlert(next);
		},
		async countNewByAgent() {
			const counts: Record<string, number> = {};
			for (const a of state.alerts.values())
				if (a.status === "new") counts[a.agentId] = (counts[a.agentId] ?? 0) + 1;
			return counts;
		},
	};
}
