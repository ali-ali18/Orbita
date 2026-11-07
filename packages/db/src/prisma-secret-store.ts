import type { Db } from "./client.ts";
import type { Clock } from "./memory-state.ts";
import type { SecretStore } from "./secret-store.ts";

export function createPrismaSecretStore(db: Db, now: Clock): SecretStore {
	return {
		async put(name, ciphertext, updatedBy) {
			const at = now();
			const row = await db.serverSecret.upsert({
				where: { name },
				update: { ciphertext, updatedBy, updatedAt: at },
				create: { name, ciphertext, updatedBy, createdAt: at, updatedAt: at },
			});
			return { name: row.name, updatedAt: row.updatedAt, updatedBy: row.updatedBy };
		},
		async get(name) {
			const row = await db.serverSecret.findUnique({ where: { name }, select: { ciphertext: true } });
			return row?.ciphertext ?? null;
		},
		async list() {
			const rows = await db.serverSecret.findMany({
				select: { name: true, updatedAt: true, updatedBy: true },
				orderBy: { name: "asc" },
			});
			return rows;
		},
		async remove(name) {
			const res = await db.serverSecret.deleteMany({ where: { name } });
			return res.count > 0;
		},
	};
}
