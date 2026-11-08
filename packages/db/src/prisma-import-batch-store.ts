import type { Db } from "./client.ts";
import type { ImportBatchRecord, ImportBatchStore, ImportBegin } from "./import-batch-store.ts";
import { isUniqueViolation } from "./prisma-errors.ts";

type Row = {
	id: string;
	fileHash: string;
	targetKey: string;
	format: string;
	createdAt: Date;
	createdCount: number | null;
	duplicateCount: number | null;
	possibleDuplicateCount: number | null;
	unrecognizedCount: number | null;
};

function toRecord(row: Row): ImportBatchRecord {
	const done =
		row.createdCount !== null &&
		row.duplicateCount !== null &&
		row.possibleDuplicateCount !== null &&
		row.unrecognizedCount !== null;
	return {
		id: row.id,
		fileHash: row.fileHash,
		targetKey: row.targetKey,
		format: row.format,
		createdAt: row.createdAt,
		summary: done
			? {
					created: row.createdCount as number,
					duplicates: row.duplicateCount as number,
					possibleDuplicates: row.possibleDuplicateCount as number,
					unrecognized: row.unrecognizedCount as number,
				}
			: null,
	};
}

export function createPrismaImportBatchStore(db: Db): ImportBatchStore {
	const store: ImportBatchStore = {
		async begin(input): Promise<ImportBegin> {
			const { fileHash, targetKey, format, now, staleBefore } = input;
			try {
				const row = await db.importBatch.create({ data: { fileHash, targetKey, format, createdAt: now } });
				return { outcome: "started", id: row.id };
			} catch (e) {
				if (!isUniqueViolation(e)) throw e;
			}
			// Já existe. Retomar uma reserva velha e sem resultado é um UPDATE só, com as condições no WHERE: se dois
			// envios tentarem, o Postgres deixa passar um.
			const taken = await db.importBatch.updateMany({
				where: { fileHash, targetKey, createdCount: null, createdAt: { lt: staleBefore } },
				data: { format, createdAt: now },
			});
			const row = await db.importBatch.findUnique({ where: { fileHash_targetKey: { fileHash, targetKey } } });
			// Sumiu entre as duas leituras (`release`): começa de novo.
			if (!row) return store.begin(input);
			if (taken.count === 1) return { outcome: "started", id: row.id };
			return { outcome: "existing", batch: toRecord(row) };
		},

		async complete(id, summary) {
			await db.importBatch.updateMany({
				where: { id },
				data: {
					createdCount: summary.created,
					duplicateCount: summary.duplicates,
					possibleDuplicateCount: summary.possibleDuplicates,
					unrecognizedCount: summary.unrecognized,
				},
			});
		},

		async release(id) {
			await db.importBatch.deleteMany({ where: { id, createdCount: null } });
		},
	};
	return store;
}
