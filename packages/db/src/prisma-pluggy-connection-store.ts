import type { PluggySyncStatus } from "@orbita/shared";
import type { Db } from "./client.ts";
import { DataError } from "./errors.ts";
import type { Clock } from "./memory-state.ts";
import { PLUGGY_CONNECTION_TAKEN_MESSAGE } from "./messages.ts";
import { normalizeConnection, normalizeSyncResult } from "./pluggy-connection-rules.ts";
import type { PluggyConnectionRecord, PluggyConnectionStore } from "./pluggy-connection-store.ts";
import { isRecordMissing, translate } from "./prisma-errors.ts";

type Row = Omit<PluggyConnectionRecord, "lastStatus"> & { lastStatus: string | null };
// O CHECK do banco só deixa passar os quatro valores de `PluggySyncStatus`.
const toRecord = (row: Row): PluggyConnectionRecord => ({
	...row,
	lastStatus: row.lastStatus as PluggySyncStatus | null,
});

export function createPrismaPluggyConnectionStore(db: Db, now: Clock): PluggyConnectionStore {
	return {
		async add(input) {
			const data = normalizeConnection(input);
			try {
				return toRecord(await db.pluggyConnection.create({ data: { ...data, createdAt: now() } }));
			} catch (e) {
				throw translate(e, () => new DataError("duplicate", PLUGGY_CONNECTION_TAKEN_MESSAGE));
			}
		},
		async remove(id) {
			const res = await db.pluggyConnection.deleteMany({ where: { id: id.trim().toLowerCase() } });
			return res.count > 0;
		},
		async get(id) {
			const row = await db.pluggyConnection.findUnique({ where: { id: id.trim().toLowerCase() } });
			return row ? toRecord(row) : null;
		},
		async list() {
			const rows = await db.pluggyConnection.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
			return rows.map(toRecord);
		},
		async recordSync(id, result) {
			const { status, error, syncedAt } = normalizeSyncResult(result);
			try {
				return toRecord(
					await db.pluggyConnection.update({
						where: { id },
						data: { lastStatus: status, lastError: error, ...(syncedAt ? { lastSyncAt: syncedAt } : {}) },
					}),
				);
			} catch (e) {
				if (isRecordMissing(e)) return null;
				throw e;
			}
		},
	};
}
