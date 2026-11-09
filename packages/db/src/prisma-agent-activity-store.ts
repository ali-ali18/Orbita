import type { AutonomousActionKind } from "@orbita/core";
import type { ActivityRecord, ActivityStatus, AgentActivityStore } from "./agent-activity-store.ts";
import type { Db } from "./client.ts";
import { notFound } from "./errors.ts";
import type { Prisma } from "./generated/prisma/client.ts";
import { cleanActivityDraft, cleanUndoNote } from "./memory-agent-activity-store.ts";
import type { Clock } from "./memory-state.ts";
import { isForeignKeyViolation, isUniqueViolation } from "./prisma-errors.ts";

const asObject = (value: unknown): Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};

interface ActivityRow {
	id: string;
	agentId: string;
	kind: string;
	dedupeKey: string;
	summary: string;
	reason: string;
	evidence: unknown;
	undo: unknown;
	status: string;
	createdAt: Date;
	undoneAt: Date | null;
	undoNote: string | null;
}

const toRecord = (row: ActivityRow): ActivityRecord => {
	const evidence = asObject(row.evidence);
	return {
		id: row.id,
		agentId: row.agentId,
		kind: row.kind as AutonomousActionKind,
		dedupeKey: row.dedupeKey,
		summary: row.summary,
		reason: row.reason,
		evidence: {
			transactionIds: Array.isArray(evidence.transactionIds)
				? evidence.transactionIds.filter((v): v is string => typeof v === "string")
				: [],
		},
		undo: asObject(row.undo),
		status: row.status as ActivityStatus,
		createdAt: row.createdAt,
		undoneAt: row.undoneAt,
		undoNote: row.undoNote,
	};
};

export function createPrismaAgentActivityStore(db: Db, now: Clock): AgentActivityStore {
	return {
		async reserve(agentId, raw) {
			const draft = cleanActivityDraft(raw);
			try {
				const row = await db.agentActivity.create({
					data: {
						agentId,
						kind: draft.kind,
						dedupeKey: draft.dedupeKey,
						summary: draft.summary,
						reason: draft.reason,
						evidence: draft.evidence as Prisma.InputJsonObject,
						undo: {},
						createdAt: now(),
					},
				});
				return toRecord(row);
			} catch (error) {
				// Já existe (feita antes, ou desfeita pelo dono): o chamador não executa de novo.
				if (isUniqueViolation(error)) return null;
				if (isForeignKeyViolation(error)) throw notFound("Agente", "o");
				throw error;
			}
		},
		async setUndo(id, undo) {
			const { count } = await db.agentActivity.updateMany({
				where: { id },
				data: { undo: undo as Prisma.InputJsonObject },
			});
			if (count === 0) return null;
			const row = await db.agentActivity.findUnique({ where: { id } });
			return row ? toRecord(row) : null;
		},
		async release(id) {
			const { count } = await db.agentActivity.deleteMany({ where: { id } });
			return count > 0;
		},
		async list(query = {}) {
			const take = Math.min(Math.max(query.limit ?? 30, 1), 100);
			const rows = await db.agentActivity.findMany({
				where: query.agentId === undefined ? {} : { agentId: query.agentId },
				orderBy: [{ createdAt: "desc" }, { id: "desc" }],
				take,
			});
			return rows.map(toRecord);
		},
		async get(id) {
			const row = await db.agentActivity.findUnique({ where: { id } });
			return row ? toRecord(row) : null;
		},
		async keys(agentId) {
			const rows = await db.agentActivity.findMany({ where: { agentId }, select: { dedupeKey: true } });
			return new Set(rows.map((r) => r.dedupeKey));
		},
		async markUndone(id, note) {
			// Comparar-e-trocar no banco: só quem muda `done` para `undone` vence.
			const { count } = await db.agentActivity.updateMany({
				where: { id, status: "done" },
				data: { status: "undone", undoneAt: now(), undoNote: cleanUndoNote(note) },
			});
			if (count === 0) return null;
			const row = await db.agentActivity.findUnique({ where: { id } });
			return row ? toRecord(row) : null;
		},
		async setUndoNote(id, note) {
			const { count } = await db.agentActivity.updateMany({
				where: { id },
				data: { undoNote: cleanUndoNote(note) },
			});
			if (count === 0) return null;
			const row = await db.agentActivity.findUnique({ where: { id } });
			return row ? toRecord(row) : null;
		},
		async reopen(id) {
			const { count } = await db.agentActivity.updateMany({
				where: { id },
				data: { status: "done", undoneAt: null, undoNote: null },
			});
			if (count === 0) return null;
			const row = await db.agentActivity.findUnique({ where: { id } });
			return row ? toRecord(row) : null;
		},
	};
}
