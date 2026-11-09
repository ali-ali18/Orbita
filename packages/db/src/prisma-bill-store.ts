import { byDueDesc, comparePayments, normalizeBill } from "./bill-rules.ts";
import type { BillRecord, BillStore } from "./bill-store.ts";
import type { Db } from "./client.ts";
import { badReference } from "./errors.ts";
import { fromDbDate, toDbDate } from "./local-date.ts";

const include = { payments: true } as const;

interface Row {
	id: string;
	cardId: string;
	source: BillRecord["source"];
	externalId: string;
	closeDate: Date | null;
	dueDate: Date;
	totalAmountCents: number;
	minimumPaymentCents: number | null;
	currency: string;
	syncedAt: Date;
	payments: Array<{ externalId: string | null; amountCents: number; date: Date }>;
}

const toRecord = (row: Row): BillRecord => ({
	id: row.id,
	cardId: row.cardId,
	source: row.source,
	externalId: row.externalId,
	closeDate: row.closeDate ? fromDbDate(row.closeDate) : null,
	dueDate: fromDbDate(row.dueDate),
	totalAmountCents: row.totalAmountCents,
	minimumPaymentCents: row.minimumPaymentCents,
	currency: row.currency,
	payments: row.payments
		.map((p) => ({ externalId: p.externalId, amountCents: p.amountCents, date: fromDbDate(p.date) }))
		.sort(comparePayments),
	syncedAt: row.syncedAt,
});

export function createPrismaBillStore(db: Db): BillStore {
	return {
		async upsert(input) {
			const data = normalizeBill(input);
			if (!(await db.card.findUnique({ where: { id: data.cardId }, select: { id: true } }))) {
				throw badReference();
			}
			const { payments, closeDate, dueDate, ...rest } = data;
			const fields = {
				...rest,
				closeDate: closeDate === null ? null : toDbDate(closeDate),
				dueDate: toDbDate(dueDate),
			};
			const row = await db.$transaction(async (tx) => {
				const bill = await tx.cardBill.upsert({
					where: { source_externalId: { source: data.source, externalId: data.externalId } },
					create: fields,
					update: fields,
				});
				await tx.cardBillPayment.deleteMany({ where: { billId: bill.id } });
				await tx.cardBillPayment.createMany({
					data: payments.map((p) => ({
						billId: bill.id,
						externalId: p.externalId,
						amountCents: p.amountCents,
						date: toDbDate(p.date),
					})),
				});
				return tx.cardBill.findUniqueOrThrow({ where: { id: bill.id }, include });
			});
			return toRecord(row);
		},
		async get(id) {
			const row = await db.cardBill.findUnique({ where: { id }, include });
			return row ? toRecord(row) : null;
		},
		async findByExternal(source, externalId) {
			const row = await db.cardBill.findUnique({
				where: { source_externalId: { source, externalId } },
				include,
			});
			return row ? toRecord(row) : null;
		},
		async listByCard(cardId) {
			const rows = await db.cardBill.findMany({ where: { cardId }, include });
			return rows.map(toRecord).sort(byDueDesc);
		},
		async list() {
			const rows = await db.cardBill.findMany({ include });
			return rows.map(toRecord).sort(byDueDesc);
		},
	};
}
