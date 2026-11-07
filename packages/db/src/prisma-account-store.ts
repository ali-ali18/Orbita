import type { AccountStore } from "./account-store.ts";
import type { Db } from "./client.ts";
import { DataError, notFound } from "./errors.ts";
import type { Clock } from "./memory-state.ts";
import { EXTERNAL_TAKEN_MESSAGE } from "./messages.ts";
import { translate } from "./prisma-errors.ts";
import { applyPatch, normalizeAccount, normalizeIdentity } from "./rules.ts";

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
	};
}
