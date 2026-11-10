import type { Db } from "./client.ts";
import { invalid, notFound } from "./errors.ts";
import {
	CLOSED_STATUS,
	canonicalDecimal,
	normalizeInvestment,
	normalizeMovement,
	normalizeSnapshot,
} from "./investment-rules.ts";
import type {
	InvestmentFields,
	InvestmentMovementRecord,
	InvestmentRecord,
	InvestmentSnapshotRecord,
	InvestmentStore,
} from "./investment-store.ts";
import { fromDbDate, toDbDate } from "./local-date.ts";
import type { Clock } from "./memory-state.ts";
import { INVESTMENT_MOVEMENT_OWNER_MESSAGE } from "./messages.ts";
import { isUniqueViolation } from "./prisma-errors.ts";

type Dec = { toFixed(): string } | null;
const dec = (v: Dec): string | null => (v === null ? null : canonicalDecimal(v.toFixed(), "decimal"));
const dayOut = (v: Date | null): string | null => (v === null ? null : fromDbDate(v));
const dayIn = (v: string | null): Date | null => (v === null ? null : toDbDate(v));

type PositionRow = Awaited<ReturnType<Db["investment"]["findUniqueOrThrow"]>>;

const toRecord = (row: PositionRow): InvestmentRecord => ({
	id: row.id,
	source: row.source,
	externalId: row.externalId,
	connectionId: row.connectionId,
	type: row.type,
	subtype: row.subtype,
	name: row.name,
	code: row.code,
	isin: row.isin,
	currency: row.currency,
	status: row.status,
	balanceCents: row.balanceCents,
	grossCents: row.grossCents,
	investedCents: row.investedCents,
	profitCents: row.profitCents,
	withdrawableCents: row.withdrawableCents,
	incomeTaxCents: row.incomeTaxCents,
	financialTaxCents: row.financialTaxCents,
	quantity: dec(row.quantity),
	unitValue: dec(row.unitValue),
	rate: dec(row.rate),
	rateType: row.rateType,
	fixedAnnualRate: dec(row.fixedAnnualRate),
	annualRate: dec(row.annualRate),
	lastMonthRate: dec(row.lastMonthRate),
	lastTwelveMonthsRate: dec(row.lastTwelveMonthsRate),
	positionDate: dayOut(row.positionDate),
	dueDate: dayOut(row.dueDate),
	issueDate: dayOut(row.issueDate),
	purchaseDate: dayOut(row.purchaseDate),
	issuer: row.issuer,
	syncedAt: row.syncedAt,
	archivedAt: row.archivedAt,
	missingReads: row.missingReads,
	movementsClosedReads: row.movementsClosedReads,
	movementsClosedReadDay: dayOut(row.movementsClosedReadDay),
	createdAt: row.createdAt,
	updatedAt: row.updatedAt,
});

/** Os campos de dados no formato de coluna (datas viram `Date`). */
const columns = (f: { source: string; externalId: string } & InvestmentFields) => ({
	...f,
	positionDate: dayIn(f.positionDate),
	dueDate: dayIn(f.dueDate),
	issueDate: dayIn(f.issueDate),
	purchaseDate: dayIn(f.purchaseDate),
});

type SnapshotRow = Awaited<ReturnType<Db["investmentSnapshot"]["findUniqueOrThrow"]>>;
const toSnapshot = (row: SnapshotRow): InvestmentSnapshotRecord => ({
	id: row.id,
	investmentId: row.investmentId,
	day: fromDbDate(row.day),
	balanceCents: row.balanceCents,
	grossCents: row.grossCents,
	investedCents: row.investedCents,
	quantity: dec(row.quantity),
	unitValue: dec(row.unitValue),
	createdAt: row.createdAt,
});

type MovementRow = Awaited<ReturnType<Db["investmentTransaction"]["findUniqueOrThrow"]>>;
const toMovement = (row: MovementRow): InvestmentMovementRecord => ({
	id: row.id,
	investmentId: row.investmentId,
	source: row.source,
	externalId: row.externalId,
	type: row.type,
	movementType: row.movementType,
	date: dayOut(row.date),
	tradeDate: dayOut(row.tradeDate),
	amountCents: row.amountCents,
	netAmountCents: row.netAmountCents,
	quantity: dec(row.quantity),
	unitValue: dec(row.unitValue),
	description: row.description,
	createdAt: row.createdAt,
});

const dayRange = (from?: string, to?: string) =>
	from === undefined && to === undefined
		? undefined
		: {
				...(from !== undefined ? { gte: toDbDate(from) } : {}),
				...(to !== undefined ? { lte: toDbDate(to) } : {}),
			};

export function createPrismaInvestmentStore(db: Db, now: Clock): InvestmentStore {
	const exists = async (id: string) => {
		const found = await db.investment.findUnique({ where: { id }, select: { id: true } });
		if (!found) throw notFound("Investimento", "o");
	};
	return {
		async upsertPosition(input) {
			const data = normalizeInvestment(input);
			const where = { source_externalId: { source: data.source, externalId: data.externalId } };
			const at = now();
			const closed = data.status === CLOSED_STATUS;
			const attempt = async () => {
				const current = await db.investment.findUnique({ where });
				if (!current) {
					const row = await db.investment.create({
						data: {
							...columns(data),
							syncedAt: at,
							archivedAt: closed ? at : null,
							missingReads: 0,
							movementsClosedReads: 0,
							movementsClosedReadDay: null,
							createdAt: at,
							updatedAt: at,
						},
					});
					return { record: toRecord(row), created: true, wasArchived: false };
				}
				const row = await db.investment.update({
					where: { id: current.id },
					data: {
						...columns(data),
						syncedAt: at,
						archivedAt: closed ? (current.archivedAt ?? at) : null,
						missingReads: 0,
						movementsClosedReads: closed ? current.movementsClosedReads : 0,
						movementsClosedReadDay: closed ? current.movementsClosedReadDay : null,
						updatedAt: at,
					},
				});
				return { record: toRecord(row), created: false, wasArchived: current.archivedAt !== null };
			};
			try {
				return await attempt();
			} catch (e) {
				// Corrida: outra rodada criou entre o find e o create.
				if (isUniqueViolation(e)) return attempt();
				throw e;
			}
		},
		async archiveMissing(source, connectionId, presentExternalIds, minAbsentReads = 1) {
			const at = now();
			const where = {
				source,
				connectionId,
				archivedAt: null,
				externalId: { notIn: [...presentExternalIds] },
			};
			// Uma transação: conta a leitura ausente e arquiva quem chegou ao mínimo.
			return db.$transaction(async (tx) => {
				await tx.investment.updateMany({ where, data: { missingReads: { increment: 1 }, updatedAt: at } });
				const r = await tx.investment.updateMany({
					where: { ...where, missingReads: { gte: minAbsentReads } },
					data: { archivedAt: at, updatedAt: at },
				});
				return r.count;
			});
		},
		async markMovementsRead(id, day) {
			await exists(id);
			// Condicional no banco: só arquivada e só se o dia da última leitura contada é outro.
			await db.investment.updateMany({
				where: {
					id,
					archivedAt: { not: null },
					OR: [{ movementsClosedReadDay: null }, { movementsClosedReadDay: { not: toDbDate(day) } }],
				},
				data: { movementsClosedReads: { increment: 1 }, movementsClosedReadDay: toDbDate(day) },
			});
			const row = await db.investment.findUniqueOrThrow({ where: { id } });
			return row.archivedAt === null ? 0 : row.movementsClosedReads;
		},
		async get(id) {
			const row = await db.investment.findUnique({ where: { id } });
			return row ? toRecord(row) : null;
		},
		async list(filter = {}) {
			const rows = await db.investment.findMany({
				where: {
					...(filter.includeArchived === true ? {} : { archivedAt: null }),
					...(filter.connectionId !== undefined ? { connectionId: filter.connectionId } : {}),
				},
				orderBy: [{ createdAt: "asc" }, { id: "asc" }],
			});
			return rows.map(toRecord);
		},
		async upsertSnapshot(investmentId, input) {
			const data = normalizeSnapshot(input);
			if (data.balanceCents === null) return null;
			await exists(investmentId);
			const { balanceCents, day, ...rest } = data;
			const values = { balanceCents, ...rest, day: toDbDate(day) };
			const row = await db.investmentSnapshot.upsert({
				where: { investmentId_day: { investmentId, day: values.day } },
				create: { investmentId, ...values, createdAt: now() },
				update: values,
			});
			return toSnapshot(row);
		},
		async listSnapshots(filter = {}) {
			const range = dayRange(filter.from, filter.to);
			const rows = await db.investmentSnapshot.findMany({
				where: {
					...(filter.investmentIds ? { investmentId: { in: [...filter.investmentIds] } } : {}),
					...(range ? { day: range } : {}),
				},
				orderBy: [{ day: "asc" }, { investmentId: "asc" }],
			});
			return rows.map(toSnapshot);
		},
		async upsertMovements(investmentId, rows) {
			const investment = await db.investment.findUnique({ where: { id: investmentId } });
			if (!investment) throw notFound("Investimento", "o");
			const cleaned = rows.map(normalizeMovement);
			return db.$transaction(async (tx) => {
				const known = await tx.investmentTransaction.findMany({
					where: { source: investment.source, externalId: { in: cleaned.map((m) => m.externalId) } },
					select: { externalId: true, investmentId: true },
				});
				const owner = new Map(known.map((k) => [k.externalId, k.investmentId]));
				for (const m of cleaned) {
					const o = owner.get(m.externalId);
					if (o !== undefined && o !== investmentId) throw invalid(INVESTMENT_MOVEMENT_OWNER_MESSAGE);
				}
				let created = 0;
				let updated = 0;
				for (const m of cleaned) {
					const values = {
						type: m.type,
						movementType: m.movementType,
						date: dayIn(m.date),
						tradeDate: dayIn(m.tradeDate),
						amountCents: m.amountCents,
						netAmountCents: m.netAmountCents,
						quantity: m.quantity,
						unitValue: m.unitValue,
						description: m.description,
					};
					if (owner.has(m.externalId)) {
						await tx.investmentTransaction.update({
							where: { source_externalId: { source: investment.source, externalId: m.externalId } },
							data: { ...values, updatedAt: now() },
						});
						updated++;
					} else {
						const at = now();
						await tx.investmentTransaction.create({
							data: {
								investmentId,
								source: investment.source,
								externalId: m.externalId,
								...values,
								createdAt: at,
								updatedAt: at,
							},
						});
						created++;
					}
				}
				return { created, updated };
			});
		},
		async listMovements(filter = {}) {
			const range = dayRange(filter.from, filter.to);
			const rows = await db.investmentTransaction.findMany({
				where: {
					...(filter.investmentIds ? { investmentId: { in: [...filter.investmentIds] } } : {}),
					...(range ? { date: range } : {}),
				},
			});
			// Ordenação feita aqui para ter exatamente a regra da memória (data nula por último, depois id externo).
			return rows
				.map(toMovement)
				.sort(
					(a, b) =>
						(a.date === null ? 1 : 0) - (b.date === null ? 1 : 0) ||
						(b.date ?? "").localeCompare(a.date ?? "") ||
						b.externalId.localeCompare(a.externalId),
				);
		},
	};
}
