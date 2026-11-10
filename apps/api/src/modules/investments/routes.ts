import { toLocalDate } from "@orbita/core";
import { investmentDetail, investmentEvolutionSeries, investmentsOverview } from "@orbita/ledger";
import { idParam, investmentEvolutionQuery } from "@orbita/shared";
import { Hono } from "hono";
import { orNotFound } from "../../http/errors.ts";
import type { ModuleDeps } from "../../http/module-deps.ts";
import type { AppEnv } from "../../http/require-device.ts";
import { validate } from "../../http/validate.ts";

/**
 * Investimentos (só leitura; os dados vêm do sync do Meu Pluggy). Contrato em `@orbita/shared` (`investments-api.ts`).
 * Todo número vem do engine (`@orbita/core`): a rota só valida, chama o `ledger` e responde.
 * `/v1/investments/evolution` vem ANTES de `/v1/investments/:id` para não ser lido como um id.
 */
export function routes({ stores, now, requireDevice }: ModuleDeps) {
	const clock = () => ({ today: toLocalDate(now()) });
	return new Hono<AppEnv>()
		.use("/v1/investments", requireDevice)
		.use("/v1/investments/*", requireDevice)
		.get("/v1/investments", async (c) => c.json(await investmentsOverview(stores, clock())))
		.get("/v1/investments/evolution", validate("query", investmentEvolutionQuery), async (c) =>
			c.json(await investmentEvolutionSeries(stores, c.req.valid("query").range, clock())),
		)
		.get("/v1/investments/:id", validate("param", idParam), async (c) =>
			c.json(orNotFound(await investmentDetail(stores, c.req.valid("param").id), "Investimento", "o")),
		);
}
