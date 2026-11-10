import { randomUUID } from "node:crypto";
import { invalid, notFound } from "./errors.ts";
import {
	CLOSED_STATUS,
	normalizeInvestment,
	normalizeMovement,
	normalizeSnapshot,
} from "./investment-rules.ts";
import type {
	InvestmentMovementRecord,
	InvestmentRecord,
	InvestmentSnapshotRecord,
	InvestmentStore,
} from "./investment-store.ts";
import { byCreated, type MemoryState } from "./memory-state.ts";
import { INVESTMENT_MOVEMENT_OWNER_MESSAGE } from "./messages.ts";

const inRange = (day: string, from?: string, to?: string) =>
	(from === undefined || day >= from) && (to === undefined || day <= to);

export function createMemoryInvestmentStore(state: MemoryState): InvestmentStore {
	const findByExternal = (source: string, externalId: string) =>
		[...state.investments.values()].find((i) => i.source === source && i.externalId === externalId);
	const need = (id: string): InvestmentRecord => {
		const found = state.investments.get(id);
		if (!found) throw notFound("Investimento", "o");
		return found;
	};
	return {
		async upsertPosition(input) {
			const data = normalizeInvestment(input);
			const at = state.now();
			const current = findByExternal(data.source, data.externalId);
			const closed = data.status === CLOSED_STATUS;
			if (!current) {
				const record: InvestmentRecord = {
					id: randomUUID(),
					...data,
					syncedAt: at,
					archivedAt: closed ? at : null,
					missingReads: 0,
					movementsClosedReads: 0,
					movementsClosedReadDay: null,
					createdAt: at,
					updatedAt: at,
				};
				state.investments.set(record.id, record);
				return { record: { ...record }, created: true, wasArchived: false };
			}
			const record: InvestmentRecord = {
				...current,
				...data,
				syncedAt: at,
				archivedAt: closed ? (current.archivedAt ?? at) : null,
				missingReads: 0,
				movementsClosedReads: closed ? current.movementsClosedReads : 0,
				movementsClosedReadDay: closed ? current.movementsClosedReadDay : null,
				updatedAt: at,
			};
			state.investments.set(record.id, record);
			return { record: { ...record }, created: false, wasArchived: current.archivedAt !== null };
		},
		async archiveMissing(source, connectionId, presentExternalIds, minAbsentReads = 1) {
			const present = new Set(presentExternalIds);
			const at = state.now();
			let count = 0;
			for (const i of [...state.investments.values()]) {
				if (i.source !== source || i.connectionId !== connectionId) continue;
				if (i.archivedAt !== null || present.has(i.externalId)) continue;
				const missingReads = i.missingReads + 1;
				const archive = missingReads >= minAbsentReads;
				state.investments.set(i.id, {
					...i,
					missingReads,
					archivedAt: archive ? at : null,
					updatedAt: at,
				});
				if (archive) count++;
			}
			return count;
		},
		async markMovementsRead(id, day) {
			const current = need(id);
			if (current.archivedAt === null) return 0;
			if (current.movementsClosedReadDay === day) return current.movementsClosedReads;
			const next = {
				...current,
				movementsClosedReads: current.movementsClosedReads + 1,
				movementsClosedReadDay: day,
			};
			state.investments.set(id, next);
			return next.movementsClosedReads;
		},
		async get(id) {
			const found = state.investments.get(id);
			return found ? { ...found } : null;
		},
		async list(filter = {}) {
			return [...state.investments.values()]
				.filter((i) => filter.includeArchived === true || i.archivedAt === null)
				.filter((i) => filter.connectionId === undefined || i.connectionId === filter.connectionId)
				.sort(byCreated)
				.map((i) => ({ ...i }));
		},
		async upsertSnapshot(investmentId, input) {
			const data = normalizeSnapshot(input);
			if (data.balanceCents === null) return null;
			need(investmentId);
			const key = `${investmentId}|${data.day}`;
			const current = state.investmentSnapshots.get(key);
			const record: InvestmentSnapshotRecord = {
				id: current?.id ?? randomUUID(),
				investmentId,
				day: data.day,
				balanceCents: data.balanceCents,
				grossCents: data.grossCents,
				investedCents: data.investedCents,
				quantity: data.quantity,
				unitValue: data.unitValue,
				createdAt: current?.createdAt ?? state.now(),
			};
			state.investmentSnapshots.set(key, record);
			return { ...record };
		},
		async listSnapshots(filter = {}) {
			const ids = filter.investmentIds ? new Set(filter.investmentIds) : null;
			return [...state.investmentSnapshots.values()]
				.filter((s) => ids === null || ids.has(s.investmentId))
				.filter((s) => inRange(s.day, filter.from, filter.to))
				.sort((a, b) => a.day.localeCompare(b.day) || a.investmentId.localeCompare(b.investmentId))
				.map((s) => ({ ...s }));
		},
		async upsertMovements(investmentId, rows) {
			const investment = need(investmentId);
			const cleaned = rows.map(normalizeMovement);
			// Tudo ou nada: uma movimentação de outra posição desfaz a chamada inteira, como a transação do banco.
			for (const m of cleaned) {
				const existing = state.investmentMovements.get(`${investment.source}|${m.externalId}`);
				if (existing && existing.investmentId !== investmentId) {
					throw invalid(INVESTMENT_MOVEMENT_OWNER_MESSAGE);
				}
			}
			let created = 0;
			let updated = 0;
			for (const m of cleaned) {
				const key = `${investment.source}|${m.externalId}`;
				const existing = state.investmentMovements.get(key);
				const record: InvestmentMovementRecord = {
					id: existing?.id ?? randomUUID(),
					investmentId,
					source: investment.source,
					...m,
					createdAt: existing?.createdAt ?? state.now(),
				};
				state.investmentMovements.set(key, record);
				if (existing) updated++;
				else created++;
			}
			return { created, updated };
		},
		async listMovements(filter = {}) {
			const ids = filter.investmentIds ? new Set(filter.investmentIds) : null;
			const dated = filter.from !== undefined || filter.to !== undefined;
			return [...state.investmentMovements.values()]
				.filter((m) => ids === null || ids.has(m.investmentId))
				.filter((m) => !dated || (m.date !== null && inRange(m.date, filter.from, filter.to)))
				.sort(
					(a, b) =>
						(a.date === null ? 1 : 0) - (b.date === null ? 1 : 0) ||
						(b.date ?? "").localeCompare(a.date ?? "") ||
						b.externalId.localeCompare(a.externalId),
				)
				.map((m) => ({ ...m }));
		},
	};
}
