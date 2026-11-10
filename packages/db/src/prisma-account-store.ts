import type { AccountStore } from "./account-store.ts";
import type { Db } from "./client.ts";
import { DataError, notFound } from "./errors.ts";
import type { Clock } from "./memory-state.ts";
import { EXTERNAL_TAKEN_MESSAGE } from "./messages.ts";
import { translate } from "./prisma-errors.ts";
import { applyPatch, cleanBalance, normalizeAccount, normalizeIdentity } from "./rules.ts";

export function createPrismaAccountStore(db: Db, now: Clock): AccountStore {
	const need = async (id: string) => {
		const found = await db.account.findUnique({ where: { id } });
		if (!found) throw notFound("Conta");
		return found;
	};
	return {
		async create(input) {
			const at = now();
			const data = { ...normalizeAccount(input), ...normalizeIdentity(input), createdAt: at, updatedAt: at };
			try {
				return await db.account.create({ data });
			} catch (e) {
				throw translate(e, () => new DataError("duplicate", EXTERNAL_TAKEN_MESSAGE));
			}
		},
		async update(id, patch) {
			const { name, kind, bankCode } = applyPatch(await need(id), patch);
			return db.account.update({
				where: { id },
				data: { ...normalizeAccount({ name, kind, bankCode }), updatedAt: now() },
			});
		},
		async archive(id) {
			const current = await need(id);
			if (current.archivedAt !== null) return current;
			const at = now();
			return db.account.update({ where: { id }, data: { archivedAt: at, updatedAt: at } });
		},
		list() {
			return db.account.findMany({
				where: { archivedAt: null },
				orderBy: [{ createdAt: "asc" }, { id: "asc" }],
			});
		},
		get(id) {
			return db.account.findUnique({ where: { id } });
		},
		findByExternal(source, externalId) {
			return db.account.findUnique({ where: { source_externalId: { source, externalId } } });
		},
		async relinkExternal(id, externalId) {
			const current = await db.account.findUnique({ where: { id } });
			const next = externalId.trim();
			if (!current || current.source === "manual" || next === "") return null;
			try {
				return await db.account.update({ where: { id }, data: { externalId: next, updatedAt: now() } });
			} catch (e) {
				const t = translate(e, () => new DataError("duplicate", EXTERNAL_TAKEN_MESSAGE));
				if (t instanceof DataError && t.code === "duplicate") return null;
				throw t;
			}
		},
		async linkConnection(id, connectionId) {
			const current = await db.account.findUnique({ where: { id } });
			if (!current || current.source === "manual") return null;
			if (current.connectionId === connectionId) return current;
			// `updatedAt` explícito: ligar a conexão não é edição do dono.
			return db.account.update({ where: { id }, data: { connectionId, updatedAt: current.updatedAt } });
		},
		async archiveByConnection(connectionId) {
			const at = now();
			const { count } = await db.account.updateMany({
				where: { connectionId, archivedAt: null },
				data: { archivedAt: at, archiveReason: "connection_removed", updatedAt: at },
			});
			return count;
		},
		async archiveOrphans(liveConnectionIds, { includeUnlinked }) {
			const at = now();
			const gone = { notIn: [...liveConnectionIds] };
			const { count } = await db.account.updateMany({
				where: {
					source: "pluggy",
					archivedAt: null,
					OR: [{ connectionId: gone }, ...(includeUnlinked ? [{ connectionId: null }] : [])],
				},
				data: { archivedAt: at, archiveReason: "connection_removed", updatedAt: at },
			});
			return count;
		},
		listRemovedByConnection() {
			return db.account.findMany({
				where: { archiveReason: "connection_removed", archivedAt: { not: null } },
				orderBy: [{ createdAt: "asc" }, { id: "asc" }],
			});
		},
		async restoreFromConnection(id) {
			const current = await db.account.findUnique({ where: { id } });
			if (!current) return null;
			if (current.archivedAt === null || current.archiveReason !== "connection_removed") return current;
			return db.account.update({
				where: { id },
				data: { archivedAt: null, archiveReason: null, updatedAt: now() },
			});
		},
		async recordBalance(id, balanceCents, syncedAt) {
			const current = await need(id);
			// `updatedAt` explícito: o `@updatedAt` do Prisma o moveria, e isto não é edição do dono.
			return db.account.update({
				where: { id },
				data: {
					balanceCents: cleanBalance(balanceCents),
					balanceSyncedAt: syncedAt,
					updatedAt: current.updatedAt,
				},
			});
		},
	};
}
