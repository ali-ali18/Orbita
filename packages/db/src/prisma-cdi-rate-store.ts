import { type CdiRateRecord, type CdiRateStore, checkCdiRow } from "./cdi-rate-store.ts";
import type { Db } from "./client.ts";
import { fromDbDate, toDbDate } from "./local-date.ts";
import type { Clock } from "./memory-state.ts";

type Row = Awaited<ReturnType<Db["cdiRate"]["findUniqueOrThrow"]>>;
const toRecord = (r: Row): CdiRateRecord => ({
	day: fromDbDate(r.day),
	rateE8: r.rateE8,
	fetchedAt: r.fetchedAt,
});

export function createPrismaCdiRateStore(db: Db, now: Clock): CdiRateStore {
	return {
		async upsertMany(rows) {
			const checked = rows.map(checkCdiRow);
			if (checked.length === 0) return { created: 0, updated: 0 };
			const at = now();
			return db.$transaction(async (tx) => {
				const known = await tx.cdiRate.findMany({
					where: { day: { in: checked.map((r) => toDbDate(r.day)) } },
				});
				const current = new Map(known.map((k) => [fromDbDate(k.day), k.rateE8]));
				const fresh = checked.filter((r) => !current.has(r.day));
				const changed = checked.filter((r) => current.has(r.day) && current.get(r.day) !== r.rateE8);
				if (fresh.length > 0) {
					await tx.cdiRate.createMany({
						data: fresh.map((r) => ({ day: toDbDate(r.day), rateE8: r.rateE8, fetchedAt: at })),
						skipDuplicates: true,
					});
				}
				for (const r of changed) {
					await tx.cdiRate.update({
						where: { day: toDbDate(r.day) },
						data: { rateE8: r.rateE8, fetchedAt: at },
					});
				}
				return { created: fresh.length, updated: changed.length };
			});
		},
		async list(filter = {}) {
			const range =
				filter.from === undefined && filter.to === undefined
					? undefined
					: {
							...(filter.from !== undefined ? { gte: toDbDate(filter.from) } : {}),
							...(filter.to !== undefined ? { lte: toDbDate(filter.to) } : {}),
						};
			const rows = await db.cdiRate.findMany({ where: range ? { day: range } : {}, orderBy: { day: "asc" } });
			return rows.map(toRecord);
		},
		async latest() {
			const row = await db.cdiRate.findFirst({ orderBy: { day: "desc" } });
			return row ? toRecord(row) : null;
		},
	};
}
