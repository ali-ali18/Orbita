import type { Db, DbClient } from "./client.ts";
import { DataError, invalid, notFound } from "./errors.ts";
import type { Prisma } from "./generated/prisma/client.ts";
import { fromDbDate, toDbDate } from "./local-date.ts";
import type { Clock } from "./memory-state.ts";
import { byGroup, byInstallment } from "./memory-transaction-store.ts";
import { HAS_REFUNDS_MESSAGE, SPLIT_HAS_REFUNDS_MESSAGE } from "./messages.ts";
import { translate } from "./prisma-errors.ts";
import { checkReferences } from "./prisma-references.ts";
import { cleanMonth } from "./rules.ts";
import {
	changedColumns,
	checkRecentOptions,
	checkTarget,
	cleanFilter,
	cleanIds,
	cleanLimit,
	DEFAULT_PENDING_LIMIT,
	DUPLICATE_INSTALLMENT_MESSAGE,
	dataOf,
	duplicateExternal,
	mergeTransaction,
	normalizeExternalInstallment,
	normalizeInstallmentGroup,
	normalizeSplit,
	normalizeTransaction,
	refundTargetError,
} from "./transaction-data.ts";
import type {
	InstallmentGroupRecord,
	TransactionData,
	TransactionFilter,
	TransactionRecord,
	TransactionStore,
} from "./transaction-store.ts";

type Row = Omit<TransactionRecord, "date"> & { date: Date; deletedAt: Date | null };

function toRecord({ deletedAt: _deleted, date, ...rest }: Row): TransactionRecord {
	return { ...rest, date: fromDbDate(date) };
}

const toCreateColumns = (data: TransactionData) => ({ ...data, date: toDbDate(data.date) });

const toColumns = (data: Partial<TransactionData>) => {
	const { date, ...rest } = data;
	return date === undefined ? rest : { ...rest, date: toDbDate(date) };
};

/** O estorno precisa apontar para uma despesa que existe e não foi apagada. */
async function checkRefundTarget(client: DbClient, data: TransactionData): Promise<void> {
	if (data.refundOfId === null) return;
	const target = await client.transaction.findFirst({
		where: { id: data.refundOfId, deletedAt: null, kind: "expense" },
		select: { id: true },
	});
	if (!target) throw refundTargetError();
}

const refsOf = (d: TransactionData) => ({
	accountIds: [d.accountId, d.counterpartAccountId],
	cardId: d.cardId,
	categoryId: d.categoryId,
});

/** Apaga os lançamentos, os estornos vivos deles e as ligações com recorrências (numa transação só). */
async function deleteCascade(tx: DbClient, rootIds: string[], at: Date): Promise<void> {
	const refunds = await tx.transaction.findMany({
		where: { refundOfId: { in: rootIds }, deletedAt: null },
		select: { id: true },
	});
	const all = [...new Set([...rootIds, ...refunds.map((r) => r.id)])];
	await tx.recurrencePosting.deleteMany({ where: { transactionId: { in: all } } });
	await tx.transaction.updateMany({
		where: { id: { in: all }, deletedAt: null },
		data: { deletedAt: at, updatedAt: at },
	});
}

const ORDER_BY_DATE = [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }] as const;
const ORDER_RECENT = [{ date: "desc" }, { id: "desc" }] as const;

/** Traduz o filtro em condições do Prisma (a regra é a de `matchesFilter`, que a store em memória usa). */
function filterConditions(f: TransactionFilter): Prisma.TransactionWhereInput[] {
	const out: Prisma.TransactionWhereInput[] = [];
	if (f.kinds?.length) out.push({ kind: { in: [...f.kinds] } });
	if (f.sources?.length) out.push({ source: { in: [...f.sources] } });
	if (f.statuses?.length) out.push({ status: { in: [...f.statuses] } });
	if (f.categoryIds?.length) out.push({ categoryId: { in: [...f.categoryIds] } });
	if (f.from !== undefined || f.to !== undefined) {
		out.push({
			date: {
				...(f.from !== undefined ? { gte: toDbDate(f.from) } : {}),
				...(f.to !== undefined ? { lte: toDbDate(f.to) } : {}),
			},
		});
	}
	if (f.minCents !== undefined || f.maxCents !== undefined) {
		out.push({
			amountCents: {
				...(f.minCents !== undefined ? { gte: f.minCents } : {}),
				...(f.maxCents !== undefined ? { lte: f.maxCents } : {}),
			},
		});
	}
	const owners: Prisma.TransactionWhereInput[] = [];
	if (f.accountIds?.length) {
		owners.push(
			{ accountId: { in: [...f.accountIds] } },
			{ counterpartAccountId: { in: [...f.accountIds] } },
		);
	}
	if (f.cardIds?.length) owners.push({ cardId: { in: [...f.cardIds] } });
	if (owners.length > 0) out.push({ OR: owners });
	return out;
}

/** Valida e grava um lançamento no client dado (o normal ou o de uma `$transaction`). */
export async function insertTransaction(
	client: DbClient,
	data: TransactionData,
	at: Date,
): Promise<TransactionRecord> {
	await checkRefundTarget(client, data);
	await checkReferences(client, refsOf(data));
	try {
		return toRecord(
			await client.transaction.create({ data: { ...toCreateColumns(data), createdAt: at, updatedAt: at } }),
		);
	} catch (e) {
		throw translate(e, duplicateExternal);
	}
}

export function createPrismaTransactionStore(db: Db, now: Clock): TransactionStore {
	const insert = (client: DbClient, data: TransactionData) => insertTransaction(client, data, now());
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

		async upsertInstallmentByExternal(source, externalId, input, installment) {
			const data = normalizeExternalInstallment({ ...input, source, externalId }, installment);
			const find = async () => {
				const row = await db.transaction.findUnique({
					where: { source_externalId: { source: data.source, externalId: data.externalId as string } },
				});
				return {
					transaction: row && row.deletedAt === null ? toRecord(row) : null,
					found: row !== null,
				};
			};
			const existing = await find();
			if (existing.found) return { created: false, transaction: existing.transaction };
			// Grupo que o dono apagou (tem parcelas, nenhuma viva): a parcela nova do banco não o ressuscita.
			const groupRows = await db.transaction.findMany({
				where: { installmentGroupId: installment.groupId },
				select: { deletedAt: true },
			});
			if (groupRows.length > 0 && groupRows.every((r) => r.deletedAt !== null)) {
				return { created: false, transaction: null };
			}
			try {
				await checkRefundTarget(db, data);
				await checkReferences(db, refsOf(data));
				const row = await db.transaction.create({
					data: { ...toCreateColumns(data), createdAt: now(), updatedAt: now() },
				});
				return { created: true, transaction: toRecord(row) };
			} catch (e) {
				// Corrida no id externo, ou (grupo, número) já ocupado por outra compra.
				const raced = await find();
				if (raced.found) return { created: false, transaction: raced.transaction };
				throw translate(e, () => new DataError("duplicate", DUPLICATE_INSTALLMENT_MESSAGE));
			}
		},

		async existsByExternal(source, externalId) {
			const row = await db.transaction.findUnique({
				where: { source_externalId: { source, externalId } },
				select: { id: true },
			});
			return row !== null;
		},

		async findByExternal(source, externalId) {
			const row = await db.transaction.findUnique({ where: { source_externalId: { source, externalId } } });
			return row && row.deletedAt === null ? toRecord(row) : null;
		},

		async update(id, patch) {
			return db.$transaction(async (tx) => {
				// Trava a linha: duas edições ao mesmo tempo se enfileiram e a segunda lê o resultado da primeira.
				const locked = await tx.$queryRaw<Array<{ id: string }>>`
					SELECT id FROM transactions WHERE id = ${id} AND deleted_at IS NULL FOR UPDATE`;
				if (locked.length === 0) throw notFound("Lançamento", "o");
				const row = await tx.transaction.findFirst({ where: { id, deletedAt: null } });
				if (!row) throw notFound("Lançamento", "o");
				const current = toRecord(row);
				const before = dataOf(current);
				const data = mergeTransaction(before, patch);
				if (before.kind === "expense" && data.kind !== "expense") {
					const refunds = await tx.transaction.count({ where: { refundOfId: id, deletedAt: null } });
					if (refunds > 0) throw invalid(HAS_REFUNDS_MESSAGE);
				}
				await checkRefundTarget(tx, data);
				await checkReferences(tx, refsOf(data), refsOf(before));
				const changed = changedColumns(before, data);
				if (Object.keys(changed).length === 0) return current;
				return toRecord(
					await tx.transaction.update({ where: { id }, data: { ...toColumns(changed), updatedAt: now() } }),
				);
			});
		},

		async splitTransaction(id, parts) {
			return db.$transaction(async (tx) => {
				// Trava a linha: duas divisões (ou uma divisão e uma edição) ao mesmo tempo se enfileiram.
				const locked = await tx.$queryRaw<Array<{ id: string }>>`
					SELECT id FROM transactions WHERE id = ${id} AND deleted_at IS NULL FOR UPDATE`;
				if (locked.length === 0) throw notFound("Lançamento", "o");
				const row = await tx.transaction.findFirst({ where: { id, deletedAt: null } });
				if (!row) throw notFound("Lançamento", "o");
				const rows = normalizeSplit(dataOf(toRecord(row)), parts);
				const refunds = await tx.transaction.count({ where: { refundOfId: id, deletedAt: null } });
				if (refunds > 0) throw invalid(SPLIT_HAS_REFUNDS_MESSAGE);
				await deleteCascade(tx, [id], now());
				const created: TransactionRecord[] = [];
				for (const data of rows) created.push(await insert(tx, data));
				return created;
			});
		},

		async softDelete(id) {
			return db.$transaction(async (tx) => {
				const live = await tx.transaction.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
				if (!live) return false;
				await deleteCascade(tx, [id], now());
				return true;
			});
		},

		async softDeleteGroup(groupId) {
			return db.$transaction(async (tx) => {
				const rows = await tx.transaction.findMany({
					where: { installmentGroupId: groupId, deletedAt: null },
					select: { id: true },
				});
				if (rows.length > 0)
					await deleteCascade(
						tx,
						rows.map((r) => r.id),
						now(),
					);
				return rows.length;
			});
		},

		async hardDeleteBySource(source) {
			if (source === "manual") throw invalid("Só dá para apagar lançamentos de uma origem de fora.");
			return db.$transaction(async (tx) => {
				const ofSource = { OR: [{ source }, { refundOf: { source } }] };
				await tx.recurrencePosting.deleteMany({ where: { transaction: ofSource } });
				// Estornos de outra origem primeiro: a chave estrangeira aponta deles para a compra.
				const refunds = await tx.transaction.deleteMany({
					where: { source: { not: source }, refundOf: { source } },
				});
				const own = await tx.transaction.deleteMany({ where: { source } });
				return refunds.count + own.count;
			});
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

		async listBudgetMonths() {
			const rows = await db.$queryRaw<Array<{ month: string }>>`
				SELECT DISTINCT budget_month AS month
				FROM transactions WHERE deleted_at IS NULL ORDER BY month DESC`;
			return rows.map((r) => r.month);
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

		async listCardPayments(cardId, { from, to }) {
			return await many(
				db.transaction.findMany({
					where: {
						cardId,
						kind: "card_payment",
						date: { gte: toDbDate(from), lte: toDbDate(to) },
						deletedAt: null,
					},
					orderBy: [...ORDER_BY_DATE],
				}),
			);
		},

		async listByTarget(target, { from, to }) {
			const { accountId, cardId } = checkTarget(target);
			return await many(
				db.transaction.findMany({
					where: {
						...(accountId !== undefined ? { accountId } : { cardId: cardId as string }),
						date: { gte: toDbDate(from), lte: toDbDate(to) },
						deletedAt: null,
					},
					orderBy: [...ORDER_BY_DATE],
				}),
			);
		},

		async listPending(options = {}) {
			const take = cleanLimit(options.limit ?? DEFAULT_PENDING_LIMIT);
			return await many(
				db.transaction.findMany({
					where: { status: "pending", deletedAt: null },
					orderBy: [...ORDER_RECENT],
					take,
				}),
			);
		},

		async getMany(ids) {
			const wanted = cleanIds(ids);
			if (wanted.length === 0) return [];
			return await many(
				db.transaction.findMany({
					where: { id: { in: wanted }, deletedAt: null },
					orderBy: [...ORDER_BY_DATE],
				}),
			);
		},

		async listCategoryNotEditedByOwner() {
			return await many(
				db.transaction.findMany({
					where: { deletedAt: null, categoryEditedByOwner: false },
					orderBy: [...ORDER_BY_DATE],
				}),
			);
		},

		async listRecent(options) {
			checkRecentOptions(options);
			const { before, filter } = options;
			const beforeDate = before ? toDbDate(before.date) : null;
			return await many(
				db.transaction.findMany({
					where: {
						deletedAt: null,
						AND: [
							...(before && beforeDate
								? [{ OR: [{ date: { lt: beforeDate } }, { date: beforeDate, id: { lt: before.id } }] }]
								: []),
							...(filter ? filterConditions(filter) : []),
						],
					},
					orderBy: [...ORDER_RECENT],
					take: options.limit,
				}),
			);
		},

		async countMatching(filter) {
			if (filter) cleanFilter(filter);
			return await db.transaction.count({
				where: { deletedAt: null, ...(filter ? { AND: filterConditions(filter) } : {}) },
			});
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
