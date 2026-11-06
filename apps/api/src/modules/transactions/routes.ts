import {
	idParam,
	installmentCreateBody,
	monthParam,
	transactionApiCreateBody,
	transactionApiUpdateBody,
	transactionDeleteQuery,
	transactionListQuery,
} from "@orbita/shared";
import { Hono } from "hono";
import { orNotFound } from "../../http/errors.ts";
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
	updateTransaction,
} from "./service.ts";

// As rotas fixas (`month`, `pending`, `installments`) vêm antes de `/:id`.
export function routes({ stores, requireDevice }: ModuleDeps) {
	const { transactions } = stores;
	return new Hono<AppEnv>()
		.use("/v1/transactions", requireDevice)
		.use("/v1/transactions/*", requireDevice)
		.get("/v1/transactions", validate("query", transactionListQuery), async (c) => {
			const page = await listRecentPage(stores, c.req.valid("query"));
			return c.json({ transactions: page.transactions.map(toTransactionDto), nextCursor: page.nextCursor });
		})
		.get("/v1/transactions/pending", async (c) =>
			c.json({ transactions: (await transactions.listPending()).map(toTransactionDto) }),
		)
		.get("/v1/transactions/month/:month", validate("param", monthParam), async (c) => {
			const { month } = c.req.valid("param");
			const rows = await transactions.listByBudgetMonth(month);
			return c.json({ month, transactions: rows.map(toTransactionDto) });
		})
		.post("/v1/transactions", validate("json", transactionApiCreateBody), async (c) => {
			const created = await createTransaction(stores, c.req.valid("json"));
			return c.json({ transaction: toTransactionDto(created) }, 201);
		})
		.post("/v1/transactions/installments", validate("json", installmentCreateBody), async (c) => {
			const created = await createInstallments(stores, c.req.valid("json"));
			return c.json(
				{ groupId: created[0]?.installmentGroupId ?? null, transactions: created.map(toTransactionDto) },
				201,
			);
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
				const deleted = await deleteTransaction(
					stores,
					c.req.valid("param").id,
					c.req.valid("query").scope,
				);
				return c.json({ deleted });
			},
		)
		.post("/v1/transactions/:id/confirm", validate("param", idParam), async (c) => {
			const confirmed = await confirmTransaction(stores, c.req.valid("param").id);
			return c.json({ transaction: toTransactionDto(confirmed) });
		});
}
