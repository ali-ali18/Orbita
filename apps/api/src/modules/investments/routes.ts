import { toLocalDate } from "@orbita/core";
import { investmentDetail, investmentEvolutionSeries, investmentsOverview } from "@orbita/ledger";
import { idParam, investmentEvolutionQuery, investmentTermsBody } from "@orbita/shared";
import { Hono } from "hono";
import { apiError, orNotFound } from "../../http/errors.ts";
import type { ModuleDeps } from "../../http/module-deps.ts";
import type { AppEnv } from "../../http/require-device.ts";
import { validate } from "../../http/validate.ts";

/**
 * Investimentos (os dados vêm do sync do Meu Pluggy; só as condições `terms` o dono grava). Contrato em `@orbita/shared` (`investments-api.ts`).
 * Todo número vem do engine (`@orbita/core`): a rota só valida, chama o `ledger` e responde.
 * `/v1/investments/evolution` vem ANTES de `/v1/investments/:id` para não ser lido como um id.
 */
export function routes({ stores, now, requireDevice }: ModuleDeps) {
	const clock = () => ({ today: toLocalDate(now()) });
	return (
		new Hono<AppEnv>()
			.use("/v1/investments", requireDevice)
			.use("/v1/investments/*", requireDevice)
			.get("/v1/investments", async (c) => c.json(await investmentsOverview(stores, clock())))
			.get("/v1/investments/evolution", validate("query", investmentEvolutionQuery), async (c) =>
				c.json(await investmentEvolutionSeries(stores, c.req.valid("query").range, clock())),
			)
			.get("/v1/investments/:id", validate("param", idParam), async (c) =>
				c.json(
					orNotFound(await investmentDetail(stores, c.req.valid("param").id, clock()), "Investimento", "o"),
				),
			)
			// As condições que o banco não manda (taxa, valor aplicado, data da aplicação). SUBSTITUI o que o dono informou;
			// o que o banco informa continua valendo. A data da aplicação não pode ser futura ("hoje" é o do servidor).
			.put("/v1/investments/:id/terms", validate("param", idParam), async (c) => {
				const { id } = c.req.valid("param");
				const record = orNotFound(await stores.investments.get(id), "Investimento", "o");
				if (record.archivedAt !== null) {
					return c.json(
						apiError(
							"investimento_encerrado",
							"Este investimento foi encerrado: não dá para informar a taxa.",
						),
						409,
					);
				}
				const raw: unknown = await c.req.json().catch(() => null);
				if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
					return c.json(
						apiError("dados_invalidos", "O corpo do pedido deve ser um objeto JSON válido."),
						400,
					);
				}
				const parsed = investmentTermsBody(clock().today).safeParse(raw);
				if (!parsed.success) {
					return c.json(
						apiError("dados_invalidos", parsed.error.issues[0]?.message ?? "Dados inválidos."),
						400,
					);
				}
				await stores.investmentTerms.put(id, parsed.data);
				const detail = orNotFound(await investmentDetail(stores, id, clock()), "Investimento", "o");
				return c.json({ position: detail.position });
			})
	);
}
