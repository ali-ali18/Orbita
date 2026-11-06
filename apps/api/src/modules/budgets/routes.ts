import type { BudgetRecord } from "@orbita/db";
import { type BudgetDto, budgetScopeParam, budgetSetBody } from "@orbita/shared";
import { Hono } from "hono";
import { orNotFound } from "../../http/errors.ts";
import type { ModuleDeps } from "../../http/module-deps.ts";
import type { AppEnv } from "../../http/require-device.ts";
import { validate } from "../../http/validate.ts";

const toBudgetDto = (b: BudgetRecord): BudgetDto => ({
	scope: b.scope,
	limitCents: b.limitCents,
	updatedAt: b.updatedAt.toISOString(),
});

/** Orçamento: um limite por escopo ("total" ou id de categoria). Criar e trocar são o mesmo PUT. */
export function routes({ stores, requireDevice }: ModuleDeps) {
	const { budgets } = stores;
	return new Hono<AppEnv>()
		.use("/v1/budgets", requireDevice)
		.use("/v1/budgets/*", requireDevice)
		.get("/v1/budgets", async (c) => c.json({ budgets: (await budgets.list()).map(toBudgetDto) }))
		.put("/v1/budgets", validate("json", budgetSetBody), async (c) => {
			const { scope, limitCents } = c.req.valid("json");
			return c.json({ budget: toBudgetDto(await budgets.set(scope, limitCents)) });
		})
		.delete("/v1/budgets/:scope", validate("param", budgetScopeParam), async (c) => {
			orNotFound((await budgets.remove(c.req.valid("param").scope)) || null, "Orçamento", "o");
			return c.body(null, 204);
		});
}
