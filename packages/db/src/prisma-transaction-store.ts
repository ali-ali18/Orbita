import type { Db, DbClient } from "./client.ts";
import { notFound } from "./errors.ts";
import { fromDbDate, toDbDate } from "./local-date.ts";
import type { Clock } from "./memory-state.ts";
import { byGroup, byInstallment } from "./memory-transaction-store.ts";
import { translate } from "./prisma-errors.ts";
import { cleanMonth } from "./rules.ts";
import {
	checkRecentOptions,
	dataOf,
	duplicateExternal,
	mergeTransaction,
	normalizeInstallmentGroup,
	normalizeTransaction,
	refundTargetError,
} from "./transaction-data.ts";
import type {
	InstallmentGroupRecord,
	TransactionData,
	TransactionRecord,
	TransactionStore,
} from "./transaction-store.ts";

type Row = Omit<TransactionRecord, "date"> & { date: Date; deletedAt: Date | null };

function toRecord({ deletedAt: _deleted, date, ...rest }: Row): TransactionRecord {
	return { ...rest, date: fromDbDate(date) };
}

const toColumns = (data: TransactionData) => ({ ...data, date: toDbDate(data.date) });

/** O estorno precisa apontar para uma despesa que existe e não foi apagada. */
async function checkRefundTarget(client: DbClient, data: TransactionData): Promise<void> {
	if (data.refundOfId === null) return;
	const target = await client.transaction.findFirst({
		where: { id: data.refundOfId, deletedAt: null, kind: "expense" },
		select: { id: true },
	});
	if (!target) throw refundTargetError();
}

const ORDER_BY_DATE = [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }] as const;
const ORDER_RECENT = [{ date: "desc" }, { id: "desc" }] as const;

export function createPrismaTransactionStore(db: Db, now: Clock): TransactionStore {
	async function insert(client: DbClient, data: TransactionData): Promise<TransactionRecord> {
		await checkRefundTarget(client, data);
		const at = now();
		try {
			return toRecord(
				await client.transaction.create({ data: { ...toColumns(data), createdAt: at, updatedAt: at } }),
			);
		} catch (e) {
			throw translate(e, duplicateExternal);
		}
	}
	const many = async (rows: Promise<Row[]>) => (await rows).map(toRecord);

	return {
		async create(input) {
			return insert(db, normalizeTransaction(input));
		},

		async createInstallmentGroup(inputs) {
			const rows = normalizeInstallmentGroup(inputs);
			// Uma transação: se uma parcela falhar, nenhuma fica.
			return db.$transaction(async (tx) => {
				const created: TransactionRecord[] = [];
				for (const data of rows) created.push(await insert(tx, data));
				return created;
			});
		},

		async upsertByExternal(source, externalId, input) {
			const data = normalizeTransaction({ ...input, source, externalId });
			const find = async () => {
				const row = await db.transaction.findUnique({
					where: { source_externalId: { source: data.source, externalId: data.externalId as string } },
				});
				return {
					created: false as const,
					transaction: row && row.deletedAt === null ? toRecord(row) : null,
					found: row !== null,
				};
			};
			const existing = await find();
			if (existing.found) return { created: false, transaction: existing.transaction };
			try {
				return { created: true, transaction: await insert(db, data) };
			} catch (e) {
				// Corrida: outra chamada gravou entre o find e o insert.
				const raced = await find();
				if (raced.found) return { created: false, transaction: raced.transaction };
				throw e;
			}
		},

		async update(id, patch) {
			const current = await db.transaction.findFirst({ where: { id, deletedAt: null } });
			if (!current) throw notFound("Lançamento", "o");
			const data = mergeTransaction(dataOf(toRecord(current)), patch);
			await checkRefundTarget(db, data);
			try {
				return toRecord(
					await db.transaction.update({ where: { id }, data: { ...toColumns(data), updatedAt: now() } }),
				);
			} catch (e) {
				throw translate(e, duplicateExternal);
			}
		},

		async softDelete(id) {
			const at = now();
			const res = await db.transaction.updateMany({
				where: { id, deletedAt: null },
				data: { deletedAt: at, updatedAt: at },
			});
			return res.count > 0;
		},

		async softDeleteGroup(groupId) {
			const at = now();
			const res = await db.transaction.updateMany({
				where: { installmentGroupId: groupId, deletedAt: null },
				data: { deletedAt: at, updatedAt: at },
			});
			return res.count;
		},

		async get(id) {
			const row = await db.transaction.findFirst({ where: { id, deletedAt: null } });
			return row ? toRecord(row) : null;
		},

		async listByBudgetMonth(month) {
			cleanMonth(month, "O mês do orçamento");
			return await many(
				db.transaction.findMany({
					where: { budgetMonth: month, deletedAt: null },
					orderBy: [...ORDER_BY_DATE],
				}),
			);
		},

		async listByInvoice(cardId, invoiceMonth) {
			cleanMonth(invoiceMonth, "O mês da fatura");
			return await many(
				db.transaction.findMany({
					where: { cardId, invoiceMonth, deletedAt: null },
					orderBy: [...ORDER_BY_DATE],
				}),
			);
		},

		async listPending() {
			return await many(
				db.transaction.findMany({
					where: { status: "pending", deletedAt: null },
					orderBy: [...ORDER_RECENT],
				}),
			);
		},

		async listRecent(options) {
			checkRecentOptions(options);
			const { before } = options;
			const beforeDate = before ? toDbDate(before.date) : null;
			return await many(
				db.transaction.findMany({
					where: {
						deletedAt: null,
						...(before && beforeDate
							? { OR: [{ date: { lt: beforeDate } }, { date: beforeDate, id: { lt: before.id } }] }
							: {}),
					},
					orderBy: [...ORDER_RECENT],
					take: options.limit,
				}),
			);
		},

		async listInstallmentGroups(activeFromMonth) {
			cleanMonth(activeFromMonth, "O mês");
			const active = await db.transaction.findMany({
				where: {
					deletedAt: null,
					installmentGroupId: { not: null },
					OR: [
						{ invoiceMonth: { gte: activeFromMonth } },
						{ invoiceMonth: null, budgetMonth: { gte: activeFromMonth } },
					],
				},
				select: { installmentGroupId: true },
				distinct: ["installmentGroupId"],
			});
			const ids = active.flatMap((r) => (r.installmentGroupId === null ? [] : [r.installmentGroupId]));
			if (ids.length === 0) return [];
			const rows = (
				await db.transaction.findMany({ where: { deletedAt: null, installmentGroupId: { in: ids } } })
			).map(toRecord);
			const groups = new Map<string, TransactionRecord[]>();
			for (const t of rows) {
				const list = groups.get(t.installmentGroupId as string) ?? [];
				list.push(t);
				groups.set(t.installmentGroupId as string, list);
			}
			const result: InstallmentGroupRecord[] = [...groups].map(([groupId, installments]) => ({
				groupId,
				installments: installments.sort(byInstallment),
			}));
			return result.sort(byGroup);
		},
	};
}
