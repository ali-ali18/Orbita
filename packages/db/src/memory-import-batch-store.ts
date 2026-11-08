import { randomUUID } from "node:crypto";
import type { ImportBatchRecord, ImportBatchStore } from "./import-batch-store.ts";

/** Implementação em memória, para testes. Segue as mesmas regras da versão Prisma. */
export function createMemoryImportBatchStore(): ImportBatchStore {
	const rows = new Map<string, ImportBatchRecord>();
	const find = (fileHash: string, targetKey: string) =>
		[...rows.values()].find((r) => r.fileHash === fileHash && r.targetKey === targetKey);
	return {
		async begin({ fileHash, targetKey, format, now, staleBefore }) {
			const current = find(fileHash, targetKey);
			if (current && !(current.summary === null && current.createdAt < staleBefore)) {
				return { outcome: "existing", batch: { ...current } };
			}
			if (current) rows.delete(current.id);
			const id = randomUUID();
			rows.set(id, { id, fileHash, targetKey, format, createdAt: now, summary: null });
			return { outcome: "started", id };
		},
		async find(fileHash, targetKey) {
			const row = find(fileHash, targetKey);
			return row ? { ...row } : null;
		},
		async complete(id, summary) {
			const row = rows.get(id);
			if (row) row.summary = { ...summary };
		},
		async release(id) {
			if (rows.get(id)?.summary === null) rows.delete(id);
		},
	};
}
