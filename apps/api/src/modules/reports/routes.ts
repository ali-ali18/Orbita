import { toLocalDate } from "@orbita/core";
import { reportForMonth } from "@orbita/ledger";
import { monthParam } from "@orbita/shared";
import { Hono } from "hono";
import type { ModuleDeps } from "../../http/module-deps.ts";
import type { AppEnv } from "../../http/require-device.ts";
import { validate } from "../../http/validate.ts";

/** Relatório mensal: tudo calculado pelo engine (`monthReport`); a rota só valida o mês e entrega. */
export function routes({ stores, now, requireDevice }: ModuleDeps) {
	return new Hono<AppEnv>()
		.use("/v1/reports", requireDevice)
		.use("/v1/reports/*", requireDevice)
		.get("/v1/reports", async (c) => c.json({ months: await stores.transactions.listBudgetMonths() }))
		.get("/v1/reports/:month", validate("param", monthParam), async (c) =>
			c.json(await reportForMonth(stores, c.req.valid("param").month, toLocalDate(now()))),
		);
}
