import type { Db } from "./client.ts";
import { badReference, DataError, notFound } from "./errors.ts";
import { fromDbDate, toDbDate } from "./local-date.ts";
import type { Clock } from "./memory-state.ts";
import { POSTING_EXISTS_MESSAGE, TRANSACTION_POSTED_MESSAGE } from "./messages.ts";
import { isUniqueViolation, translate } from "./prisma-errors.ts";
import type { RecurrenceData, RecurrenceRecord, RecurrenceStore } from "./recurrence-store.ts";
import { applyPatch, cleanMonth, normalizeRecurrence } from "./rules.ts";

type Row = Omit<RecurrenceRecord, "startDate" | "endDate"> & { startDate: Date; endDate: Date | null };

const toRecord = (row: Row): RecurrenceRecord => ({
	...row,
	startDate: fromDbDate(row.startDate),
	endDate: row.endDate ? fromDbDate(row.endDate) : null,
});

const toColumns = (d: RecurrenceData) => ({
	...d,
	startDate: toDbDate(d.startDate),
	endDate: d.endDate ? toDbDate(d.endDate) : null,
});

export function createPrismaRecurrenceStore(db: Db, now: Clock): RecurrenceStore {
	const need = async (id: string) => {
		const found = await db.recurrence.findUnique({ where: { id } });
		if (!found) throw notFound("Recorrência");
		return toRecord(found);
	};
	return {
		async create(input) {
			const data = normalizeRecurrence({
				...input,
				endDate: input.endDate ?? null,
				categoryId: input.categoryId ?? null,
				accountId: input.accountId ?? null,
				cardId: input.cardId ?? null,
			});
			const at = now();
			try {
				return toRecord(
					await db.recurrence.create({ data: { ...toColumns(data), createdAt: at, updatedAt: at } }),
				);
			} catch (e) {
				throw translate(e, badReference);
			}
		},
		async update(id, patch) {
			const { id: _id, archivedAt: _a, createdAt: _c, updatedAt: _u, ...data } = await need(id);
			const next = normalizeRecurrence(applyPatch(data, patch));
			try {
				return toRecord(
					await db.recurrence.update({ where: { id }, data: { ...toColumns(next), updatedAt: now() } }),
				);
			} catch (e) {
				throw translate(e, badReference);
			}
		},
		async archive(id) {
			const current = await need(id);
			if (current.archivedAt !== null) return current;
			const at = now();
			return toRecord(await db.recurrence.update({ where: { id }, data: { archivedAt: at, updatedAt: at } }));
		},
		async list() {
			const rows = await db.recurrence.findMany({
				where: { archivedAt: null },
				orderBy: [{ createdAt: "asc" }, { id: "asc" }],
			});
			return rows.map(toRecord);
		},
		async get(id) {
			const row = await db.recurrence.findUnique({ where: { id } });
			return row ? toRecord(row) : null;
		},
		async listPostings(month) {
			cleanMonth(month);
			const rows = await db.recurrencePosting.findMany({
				where: { month },
				orderBy: [{ createdAt: "asc" }, { id: "asc" }],
			});
			return rows.map((r) => ({
				recurrenceId: r.recurrenceId,
				month: r.month,
				transactionId: r.transactionId,
			}));
		},
		async recordPosting(input) {
			cleanMonth(input.month);
			const { recurrenceId, month, transactionId } = input;
			const [recurrence, transaction] = await Promise.all([
				db.recurrence.count({ where: { id: recurrenceId } }),
				db.transaction.count({ where: { id: transactionId } }),
			]);
			if (recurrence === 0 || transaction === 0) throw badReference();
			const onUnique = async () => {
				const sameMonth = await db.recurrencePosting.count({ where: { recurrenceId, month } });
				return new DataError(
					"duplicate",
					sameMonth > 0 ? POSTING_EXISTS_MESSAGE : TRANSACTION_POSTED_MESSAGE,
				);
			};
			try {
				await db.recurrencePosting.create({ data: { recurrenceId, month, transactionId } });
			} catch (e) {
				if (isUniqueViolation(e)) throw await onUnique();
				throw translate(e, badReference);
			}
			return { recurrenceId, month, transactionId };
		},
	};
}
