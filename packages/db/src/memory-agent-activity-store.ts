import { randomUUID } from "node:crypto";
import { AUTONOMOUS_ACTION_KINDS } from "@orbita/core";
import {
	ACTIVITY_KEY_MAX,
	ACTIVITY_NOTE_MAX,
	ACTIVITY_REASON_MAX,
	ACTIVITY_SUMMARY_MAX,
	type ActivityDraft,
	type ActivityRecord,
	type AgentActivityStore,
} from "./agent-activity-store.ts";
import { invalid, notFound } from "./errors.ts";
import type { MemoryState } from "./memory-state.ts";

const clean = (value: string, label: string, max: number): string => {
	const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
	if (text.length === 0) throw invalid(`Informe ${label}.`);
	if (text.length > max)
		throw invalid(`${label[0]?.toUpperCase()}${label.slice(1)} passou de ${max} letras.`);
	return text;
};

/** Regras comuns às duas implementações (Prisma e memória). */
export function cleanActivityDraft(draft: ActivityDraft) {
	if (!(AUTONOMOUS_ACTION_KINDS as readonly string[]).includes(draft.kind)) {
		throw invalid("Tipo de atividade inválido.");
	}
	return {
		kind: draft.kind,
		dedupeKey: clean(draft.dedupeKey, "a chave da atividade", ACTIVITY_KEY_MAX),
		summary: clean(draft.summary, "o resumo da atividade", ACTIVITY_SUMMARY_MAX),
		reason: clean(draft.reason, "o motivo da atividade", ACTIVITY_REASON_MAX),
		evidence: { transactionIds: [...new Set(draft.evidence.transactionIds)].slice(0, 20) },
	};
}

export const cleanUndoNote = (note: string | null | undefined): string | null =>
	note ? note.replace(/\s+/g, " ").trim().slice(0, ACTIVITY_NOTE_MAX) || null : null;

export const compareActivitiesNewestFirst = (a: ActivityRecord, b: ActivityRecord): number =>
	b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1);

const copy = (r: ActivityRecord): ActivityRecord => ({
	...r,
	evidence: { transactionIds: [...r.evidence.transactionIds] },
	undo: structuredClone(r.undo),
});

export function createMemoryAgentActivityStore(state: MemoryState): AgentActivityStore {
	return {
		async reserve(agentId, raw) {
			if (!state.agents.has(agentId)) throw notFound("Agente", "o");
			const draft = cleanActivityDraft(raw);
			for (const a of state.agentActivities.values()) {
				if (a.agentId === agentId && a.dedupeKey === draft.dedupeKey) return null;
			}
			const record: ActivityRecord = {
				id: randomUUID(),
				agentId,
				...draft,
				undo: {},
				status: "done",
				createdAt: state.now(),
				undoneAt: null,
				undoNote: null,
			};
			state.agentActivities.set(record.id, record);
			return copy(record);
		},
		async setUndo(id, undo) {
			const current = state.agentActivities.get(id);
			if (!current) return null;
			const next = { ...current, undo: structuredClone(undo) };
			state.agentActivities.set(id, next);
			return copy(next);
		},
		async release(id) {
			return state.agentActivities.delete(id);
		},
		async list(query = {}) {
			const take = Math.min(Math.max(query.limit ?? 30, 1), 100);
			return [...state.agentActivities.values()]
				.filter((a) => query.agentId === undefined || a.agentId === query.agentId)
				.sort(compareActivitiesNewestFirst)
				.slice(0, take)
				.map(copy);
		},
		async get(id) {
			const found = state.agentActivities.get(id);
			return found ? copy(found) : null;
		},
		async keys(agentId) {
			return new Set(
				[...state.agentActivities.values()].filter((a) => a.agentId === agentId).map((a) => a.dedupeKey),
			);
		},
		async markUndone(id, note) {
			const current = state.agentActivities.get(id);
			if (!current) return null;
			if (current.status !== "done") return null;
			const next: ActivityRecord = {
				...current,
				status: "undone",
				undoneAt: state.now(),
				undoNote: cleanUndoNote(note),
			};
			state.agentActivities.set(id, next);
			return copy(next);
		},
		async setUndoNote(id, note) {
			const current = state.agentActivities.get(id);
			if (!current) return null;
			const next: ActivityRecord = { ...current, undoNote: cleanUndoNote(note) };
			state.agentActivities.set(id, next);
			return copy(next);
		},
		async reopen(id) {
			const current = state.agentActivities.get(id);
			if (!current) return null;
			const next: ActivityRecord = { ...current, status: "done", undoneAt: null, undoNote: null };
			state.agentActivities.set(id, next);
			return copy(next);
		},
	};
}
