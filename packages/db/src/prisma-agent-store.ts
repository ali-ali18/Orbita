import {
	type AgentFrequency,
	type AlertKind,
	type AlertStatus,
	BUILTIN_AGENT_KEYS,
	type BuiltinAgentKey,
} from "@orbita/shared";
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
import type { Db } from "./client.ts";
import { badReference, invalid, notFound } from "./errors.ts";
import type { Prisma } from "./generated/prisma/client.ts";
import type { Clock } from "./memory-state.ts";
import { isForeignKeyViolation, isUniqueViolation } from "./prisma-errors.ts";

const asObject = (value: unknown): Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};

interface AgentRow {
	id: string;
	builtinKey: string | null;
	name: string;
	instructions: string | null;
	tools: string[];
	enabled: boolean;
	frequency: string;
	runHour: number;
	runDay: number | null;
	settings: unknown;
	model: string | null;
	lastRunAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

const toAgent = (row: AgentRow): AgentRecord => ({
	id: row.id,
	builtinKey: row.builtinKey as BuiltinAgentKey | null,
	name: row.name,
	instructions: row.instructions,
	tools: row.tools,
	enabled: row.enabled,
	frequency: row.frequency as AgentFrequency,
	runHour: row.runHour,
	runDay: row.runDay,
	settings: asObject(row.settings),
	model: row.model,
	lastRunAt: row.lastRunAt,
	createdAt: row.createdAt,
	updatedAt: row.updatedAt,
});

interface AlertRow {
	id: string;
	agentId: string;
	kind: string;
	dedupeKey: string;
	title: string;
	body: string;
	wordedByAi: boolean;
	data: unknown;
	status: string;
	proposalId: string | null;
	transactionId: string | null;
	createdAt: Date;
	seenAt: Date | null;
	dismissedAt: Date | null;
}

const toAlert = (row: AlertRow): AlertRecord => ({
	id: row.id,
	agentId: row.agentId,
	kind: row.kind as AlertKind,
	dedupeKey: row.dedupeKey,
	title: row.title,
	body: row.body,
	wordedByAi: row.wordedByAi,
	data: asObject(row.data),
	status: row.status as AlertStatus,
	proposalId: row.proposalId,
	transactionId: row.transactionId,
	createdAt: row.createdAt,
	seenAt: row.seenAt,
	dismissedAt: row.dismissedAt,
});

const rank = (r: AgentRecord) =>
	r.builtinKey === null ? Number.MAX_SAFE_INTEGER : BUILTIN_AGENT_KEYS.indexOf(r.builtinKey);

export function createPrismaAgentStore(db: Db, now: Clock): AgentStore {
	const need = async (id: string): Promise<AgentRow> => {
		const found = await db.agent.findUnique({ where: { id } });
		if (!found) throw notFound("Agente", "o");
		return found;
	};
	return {
		async ensureBuiltins(seeds) {
			if (seeds.length === 0) return;
			const data = seeds.map((seed) => {
				const schedule = cleanSchedule(seed);
				const at = now();
				return {
					builtinKey: seed.builtinKey,
					name: cleanAgentName(seed.name),
					enabled: seed.enabled,
					frequency: schedule.frequency,
					runHour: schedule.runHour,
					runDay: schedule.runDay,
					settings: seed.settings as Prisma.InputJsonObject,
					createdAt: at,
					updatedAt: at,
				};
			});
			// A unicidade de `builtin_key` decide: dois processos criando juntos não duplicam.
			await db.agent.createMany({ data, skipDuplicates: true });
		},
		async list() {
			const rows = await db.agent.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
			return rows.map(toAgent).sort((a, b) => rank(a) - rank(b));
		},
		async get(id) {
			const row = await db.agent.findUnique({ where: { id } });
			return row ? toAgent(row) : null;
		},
		async createCustom(input) {
			const schedule = cleanSchedule(input);
			const at = now();
			const row = await db.agent.create({
				data: {
					name: cleanAgentName(input.name),
					instructions: cleanAgentInstructions(input.instructions),
					tools: cleanAgentTools(input.tools),
					enabled: true,
					frequency: schedule.frequency,
					runHour: schedule.runHour,
					runDay: schedule.runDay,
					createdAt: at,
					updatedAt: at,
				},
			});
			return toAgent(row);
		},
		async update(id, patch) {
			const current = toAgent(await need(id));
			const ownerOnly =
				patch.name !== undefined || patch.instructions !== undefined || patch.tools !== undefined;
			if (ownerOnly && current.builtinKey !== null) throw invalid(BUILTIN_LOCKED_MESSAGE);
			const schedule = cleanSchedule({
				frequency: patch.frequency ?? current.frequency,
				runHour: patch.runHour ?? current.runHour,
				runDay:
					patch.runDay !== undefined ? patch.runDay : patch.frequency !== undefined ? null : current.runDay,
			});
			const row = await db.agent.update({
				where: { id },
				data: {
					name: patch.name !== undefined ? cleanAgentName(patch.name) : current.name,
					instructions:
						patch.instructions !== undefined
							? cleanAgentInstructions(patch.instructions)
							: current.instructions,
					tools: patch.tools !== undefined ? cleanAgentTools(patch.tools) : current.tools,
					enabled: patch.enabled ?? current.enabled,
					frequency: schedule.frequency,
					runHour: schedule.runHour,
					runDay: schedule.runDay,
					settings: (patch.settings !== undefined
						? patch.settings
						: current.settings) as Prisma.InputJsonObject,
					model: patch.model !== undefined ? cleanModel(patch.model) : current.model,
					updatedAt: now(),
				},
			});
			return toAgent(row);
		},
		async deleteCustom(id) {
			const current = await db.agent.findUnique({ where: { id }, select: { builtinKey: true } });
			if (!current) return false;
			if (current.builtinKey !== null) throw invalid(BUILTIN_UNDELETABLE_MESSAGE);
			const { count } = await db.agent.deleteMany({ where: { id, builtinKey: null } });
			return count > 0;
		},
		async markRun(id, at) {
			const { count } = await db.agent.updateMany({ where: { id }, data: { lastRunAt: at } });
			if (count === 0) throw notFound("Agente", "o");
		},

		async addAlerts(agentId, drafts) {
			await need(agentId);
			const created: AlertRecord[] = [];
			for (const raw of drafts) {
				const draft = cleanAlertDraft(raw);
				try {
					const row = await db.alert.create({
						data: {
							agentId,
							kind: draft.kind,
							dedupeKey: draft.dedupeKey,
							title: draft.title,
							body: draft.body,
							data: draft.data as Prisma.InputJsonObject,
							transactionId: draft.transactionId,
							proposalId: draft.proposalId,
							wordedByAi: draft.wordedByAi,
							createdAt: now(),
						},
					});
					created.push(toAlert(row));
				} catch (error) {
					// Já existe (rodou de novo no mesmo período): não recria, nem reabre o que foi dispensado.
					if (isUniqueViolation(error)) continue;
					if (isForeignKeyViolation(error)) throw badReference();
					throw error;
				}
			}
			return created;
		},
		async listAlerts(query = {}) {
			const take = Math.min(Math.max(query.limit ?? 30, 1), 100);
			const rows = await db.alert.findMany({
				where: {
					...(query.status === undefined ? {} : { status: query.status }),
					...(query.agentId === undefined ? {} : { agentId: query.agentId }),
				},
				orderBy: [{ createdAt: "desc" }, { id: "desc" }],
				take,
			});
			return rows.map(toAlert);
		},
		async getAlert(id) {
			const row = await db.alert.findUnique({ where: { id } });
			return row ? toAlert(row) : null;
		},
		async setAlertStatus(id, status) {
			const at = now();
			// Compara e troca no banco: dois toques seguidos não regravam o carimbo.
			if (status === "seen") {
				await db.alert.updateMany({ where: { id, status: "new" }, data: { status: "seen", seenAt: at } });
			} else {
				await db.alert.updateMany({
					where: { id, status: { not: "dismissed" } },
					data: { status: "dismissed", dismissedAt: at },
				});
			}
			const row = await db.alert.findUnique({ where: { id } });
			return row ? toAlert(row) : null;
		},
		async setAlertBody(id, body, wordedByAi) {
			const text = cleanAlertBody(body);
			const { count } = await db.alert.updateMany({ where: { id }, data: { body: text, wordedByAi } });
			if (count === 0) return null;
			const row = await db.alert.findUnique({ where: { id } });
			return row ? toAlert(row) : null;
		},
		async countNewByAgent() {
			const groups = await db.alert.groupBy({
				by: ["agentId"],
				where: { status: "new" },
				_count: { _all: true },
			});
			return Object.fromEntries(groups.map((g) => [g.agentId, g._count._all]));
		},
	};
}
