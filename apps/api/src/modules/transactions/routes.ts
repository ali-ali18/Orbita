import {
	idParam,
	installmentCreateBody,
	monthParam,
	pendingListQuery,
	transactionApiCreateBody,
	transactionApiUpdateBody,
	transactionCountQuery,
	transactionDeleteQuery,
	transactionListQuery,
	transactionSplitBody,
} from "@orbita/shared";
import { Hono } from "hono";
import { orNotFound } from "../../http/errors.ts";
import { idempotent } from "../../http/idempotency.ts";
import type { ModuleDeps } from "../../http/module-deps.ts";
import type { AppEnv } from "../../http/require-device.ts";
import { validate } from "../../http/validate.ts";
import { toTransactionDto } from "./dto.ts";
import {
	confirmTransaction,
	createInstallments,
	createTransaction,
	deleteTransaction,
	listRecentPage,
	splitTransaction,
	updateTransaction,
} from "./service.ts";

// As rotas fixas (`month`, `pending`, `count`, `installments`) vêm antes de `/:id`.
export function routes({ stores, now, requireDevice }: ModuleDeps) {
	const { transactions } = stores;
	const idempotency = { store: stores.idempotency, now };
	return new Hono<AppEnv>()
		.use("/v1/transactions", requireDevice)
		.use("/v1/transactions/*", requireDevice)
		.get("/v1/transactions", validate("query", transactionListQuery), async (c) => {
			const page = await listRecentPage(stores, c.req.valid("query"));
			return c.json({ transactions: page.transactions.map(toTransactionDto), nextCursor: page.nextCursor });
		})
		.get("/v1/transactions/count", validate("query", transactionCountQuery), async (c) => {
			return c.json({ count: await transactions.countMatching(c.req.valid("query")) });
		})
		.get("/v1/transactions/pending", validate("query", pendingListQuery), async (c) => {
			const { limit } = c.req.valid("query");
			// Pede um a mais só para saber se há outra página.
			const rows = await transactions.listPending({ limit: limit + 1 });
			return c.json({
				transactions: rows.slice(0, limit).map(toTransactionDto),
				hasMore: rows.length > limit,
			});
		})
		.get("/v1/transactions/month/:month", validate("param", monthParam), async (c) => {
			const { month } = c.req.valid("param");
			const rows = await transactions.listByBudgetMonth(month);
			return c.json({ month, transactions: rows.map(toTransactionDto) });
		})
		.post("/v1/transactions", validate("json", transactionApiCreateBody), async (c) => {
			const body = c.req.valid("json");
			const result = await idempotent(c, idempotency, body, 201, async () => ({
				transaction: toTransactionDto(await createTransaction(stores, body)),
			}));
			return c.json(result, 201);
		})
		.post("/v1/transactions/installments", validate("json", installmentCreateBody), async (c) => {
			const body = c.req.valid("json");
			const result = await idempotent(c, idempotency, body, 201, async () => {
				const created = await createInstallments(stores, body);
				return {
					groupId: created[0]?.installmentGroupId ?? null,
					transactions: created.map(toTransactionDto),
				};
			});
			return c.json(result, 201);
		})
		.get("/v1/transactions/:id", validate("param", idParam), async (c) => {
			const found = orNotFound(await transactions.get(c.req.valid("param").id), "Lançamento", "o");
			return c.json({ transaction: toTransactionDto(found) });
		})
		.patch(
			"/v1/transactions/:id",
			validate("param", idParam),
			validate("json", transactionApiUpdateBody),
			async (c) => {
				const updated = await updateTransaction(stores, c.req.valid("param").id, c.req.valid("json"));
				return c.json({ transaction: toTransactionDto(updated) });
			},
		)
		.delete(
			"/v1/transactions/:id",
			validate("param", idParam),
			validate("query", transactionDeleteQuery),
			async (c) => {
				const deleted = await deleteTransaction(stores, c.req.valid("param").id, c.req.valid("query").scope);
				return c.json({ deleted });
			},
		)
		.post(
			"/v1/transactions/:id/split",
			validate("param", idParam),
			validate("json", transactionSplitBody),
			async (c) => {
				const { id } = c.req.valid("param");
				const body = c.req.valid("json");
				const result = await idempotent(c, idempotency, body, 201, async () => ({
					transactions: (await splitTransaction(stores, id, body)).map(toTransactionDto),
				}));
				return c.json(result, 201);
			},
		)
		.post("/v1/transactions/:id/confirm", validate("param", idParam), async (c) => {
			const confirmed = await confirmTransaction(stores, c.req.valid("param").id);
			return c.json({ transaction: toTransactionDto(confirmed) });
		});
}
