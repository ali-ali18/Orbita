import type { ClosingRule } from "@orbita/core";
import { type CardRecord, type CardStore, type ClosingRuleSource, toCardConfig } from "./card-store.ts";
import type { Db } from "./client.ts";
import { DataError, notFound } from "./errors.ts";
import type { ClosingRule as DbClosingRule } from "./generated/prisma/enums.ts";
import type { Clock } from "./memory-state.ts";
import { EXTERNAL_TAKEN_MESSAGE } from "./messages.ts";
import { translate } from "./prisma-errors.ts";
import { applyCardPatch, cleanAvailable, normalizeCard, normalizeIdentity } from "./rules.ts";

const toDbRule = (rule: ClosingRule): DbClosingRule =>
	rule === "closing-day-included" ? "closing_day_included" : "closing_day_next";
const fromDbRule = (rule: DbClosingRule): ClosingRule =>
	rule === "closing_day_included" ? "closing-day-included" : "closing-day-next";

type Row = Omit<CardRecord, "closingRule" | "closingRuleSource"> & {
	closingRule: DbClosingRule;
	closingRuleSource: string;
};
const toRecord = (row: Row): CardRecord => ({
	...row,
	closingRule: fromDbRule(row.closingRule),
	closingRuleSource: row.closingRuleSource as ClosingRuleSource,
});
const toData = (data: ReturnType<typeof normalizeCard>) => ({
	...data,
	closingRule: toDbRule(data.closingRule),
});

export function createPrismaCardStore(db: Db, now: Clock): CardStore {
	const need = async (id: string) => {
		const found = await db.card.findUnique({ where: { id } });
		if (!found) throw notFound("Cartão", "o");
		return toRecord(found);
	};
	return {
		async create(input) {
			const at = now();
			const data = {
				...toData(normalizeCard(input)),
				...normalizeIdentity(input),
				createdAt: at,
				updatedAt: at,
			};
			try {
				return toRecord(await db.card.create({ data }));
			} catch (e) {
				throw translate(e, () => new DataError("duplicate", EXTERNAL_TAKEN_MESSAGE));
			}
		},
		async update(id, patch) {
			const data = normalizeCard(applyCardPatch(await need(id), patch));
			return toRecord(await db.card.update({ where: { id }, data: { ...toData(data), updatedAt: now() } }));
		},
		async archive(id) {
			const current = await need(id);
			if (current.archivedAt !== null) return current;
			const at = now();
			return toRecord(await db.card.update({ where: { id }, data: { archivedAt: at, updatedAt: at } }));
		},
		async list() {
			const rows = await db.card.findMany({
				where: { archivedAt: null },
				orderBy: [{ createdAt: "asc" }, { id: "asc" }],
			});
			return rows.map(toRecord);
		},
		async get(id) {
			const row = await db.card.findUnique({ where: { id } });
			return row ? toRecord(row) : null;
		},
		async findByExternal(source, externalId) {
			const row = await db.card.findUnique({ where: { source_externalId: { source, externalId } } });
			return row ? toRecord(row) : null;
		},
		async relinkExternal(id, externalId) {
			const current = await db.card.findUnique({ where: { id } });
			const next = externalId.trim();
			if (!current || current.source === "manual" || next === "") return null;
			try {
				return toRecord(
					await db.card.update({ where: { id }, data: { externalId: next, updatedAt: now() } }),
				);
			} catch (e) {
				const t = translate(e, () => new DataError("duplicate", EXTERNAL_TAKEN_MESSAGE));
				if (t instanceof DataError && t.code === "duplicate") return null;
				throw t;
			}
		},
		async linkConnection(id, connectionId) {
			const current = await db.card.findUnique({ where: { id } });
			if (!current || current.source === "manual") return null;
			if (current.connectionId === connectionId) return toRecord(current);
			// `updatedAt` explícito: ligar a conexão não é edição do dono.
			return toRecord(
				await db.card.update({ where: { id }, data: { connectionId, updatedAt: current.updatedAt } }),
			);
		},
		async archiveByConnection(connectionId) {
			const at = now();
			const { count } = await db.card.updateMany({
				where: { connectionId, archivedAt: null },
				data: { archivedAt: at, archiveReason: "connection_removed", updatedAt: at },
			});
			return count;
		},
		async archiveOrphans(liveConnectionIds, { includeUnlinked }) {
			const at = now();
			const gone = { notIn: [...liveConnectionIds] };
			const { count } = await db.card.updateMany({
				where: {
					source: "pluggy",
					archivedAt: null,
					OR: [{ connectionId: gone }, ...(includeUnlinked ? [{ connectionId: null }] : [])],
				},
				data: { archivedAt: at, archiveReason: "connection_removed", updatedAt: at },
			});
			return count;
		},
		async restoreFromConnection(id) {
			const current = await db.card.findUnique({ where: { id } });
			if (!current) return null;
			if (current.archivedAt === null || current.archiveReason !== "connection_removed")
				return toRecord(current);
			return toRecord(
				await db.card.update({
					where: { id },
					data: { archivedAt: null, archiveReason: null, updatedAt: now() },
				}),
			);
		},
		async getConfig(id) {
			const row = await db.card.findUnique({ where: { id } });
			return row ? toCardConfig(toRecord(row)) : null;
		},
		async recordAvailable(id, availableCents, syncedAt, balanceCents) {
			const current = await need(id);
			// `updatedAt` explícito: o `@updatedAt` do Prisma o moveria, e isto não é edição do dono.
			const data = {
				availableCents: cleanAvailable(availableCents),
				// Saldo ausente na leitura grava null: o último, de outra rodada, enganaria a conferência do limite.
				balanceCents:
					balanceCents === undefined || balanceCents === null ? null : cleanAvailable(balanceCents),
				limitSyncedAt: syncedAt,
				updatedAt: current.updatedAt,
			};
			return toRecord(await db.card.update({ where: { id }, data }));
		},
	};
}
