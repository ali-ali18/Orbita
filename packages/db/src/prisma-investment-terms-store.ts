import type { InvestmentRateKind, TermSource } from "@orbita/core";
import type { Db } from "./client.ts";
import { notFound } from "./errors.ts";
import { isEmptyTerms, normalizeTerms } from "./investment-terms-rules.ts";
import type { InvestmentTermsRecord, InvestmentTermsStore } from "./investment-terms-store.ts";
import { fromDbDate, toDbDate } from "./local-date.ts";
import type { Clock } from "./memory-state.ts";
import { isForeignKeyViolation } from "./prisma-errors.ts";

type Row = Awaited<ReturnType<Db["investmentTerms"]["findUniqueOrThrow"]>>;
const toRecord = (r: Row): InvestmentTermsRecord => ({
	investmentId: r.investmentId,
	rateKind: r.rateKind as InvestmentRateKind | null,
	rateBps: r.rateBps,
	rateSource: r.rateSource as TermSource | null,
	investedCents: r.investedCents,
	investedSource: r.investedSource as TermSource | null,
	startDate: r.startDate === null ? null : fromDbDate(r.startDate),
	startDateSource: r.startDateSource as TermSource | null,
	createdAt: r.createdAt,
	updatedAt: r.updatedAt,
});

export function createPrismaInvestmentTermsStore(db: Db, now: Clock): InvestmentTermsStore {
	return {
		async put(investmentId, input) {
			const found = await db.investment.findUnique({ where: { id: investmentId }, select: { id: true } });
			if (!found) throw notFound("Investimento", "o");
			const data = normalizeTerms(input);
			if (isEmptyTerms(data)) {
				await db.investmentTerms.deleteMany({ where: { investmentId } });
				return null;
			}
			const at = now();
			const values = {
				...data,
				startDate: data.startDate === null ? null : toDbDate(data.startDate),
				updatedAt: at,
			};
			try {
				const row = await db.investmentTerms.upsert({
					where: { investmentId },
					create: { investmentId, ...values, createdAt: at },
					update: values,
				});
				return toRecord(row);
			} catch (e) {
				// A posição sumiu entre a conferência e a gravação.
				if (isForeignKeyViolation(e)) throw notFound("Investimento", "o");
				throw e;
			}
		},
		async get(investmentId) {
			const row = await db.investmentTerms.findUnique({ where: { investmentId } });
			return row ? toRecord(row) : null;
		},
		async list() {
			const rows = await db.investmentTerms.findMany({ orderBy: { investmentId: "asc" } });
			return rows.map(toRecord);
		},
	};
}
