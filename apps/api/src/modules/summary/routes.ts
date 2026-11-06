import { monthOf, toLocalDate } from "@orbita/core";
import { cardInvoiceParam, installmentsQuery, monthParam } from "@orbita/shared";
import { Hono } from "hono";
import type { ModuleDeps } from "../../http/module-deps.ts";
import type { AppEnv } from "../../http/require-device.ts";
import { validate } from "../../http/validate.ts";
import { toCardDto } from "../cards/dto.ts";
import { toTransactionDto } from "../transactions/dto.ts";
import { activeInstallments, cardInvoice, monthSummary } from "./service.ts";

/** Telas de leitura: resumo do mês, fatura do cartão e parcelamentos. Sempre calculadas pelo engine. */
export function routes({ stores, now, requireDevice }: ModuleDeps) {
	return new Hono<AppEnv>()
		.use("/v1/summary/*", requireDevice)
		.use("/v1/cards/:id/invoices/*", requireDevice)
		.use("/v1/installments", requireDevice)
		.get("/v1/summary/:month", validate("param", monthParam), async (c) =>
			c.json(await monthSummary(stores, c.req.valid("param").month, toLocalDate(now()))),
		)
		.get("/v1/cards/:id/invoices/:month", validate("param", cardInvoiceParam), async (c) => {
			const { id, month } = c.req.valid("param");
			const result = await cardInvoice(stores, id, month, toLocalDate(now()));
			return c.json({
				card: toCardDto(result.card),
				invoice: result.invoice,
				composition: result.composition,
				transactions: result.transactions.map(toTransactionDto),
			});
		})
		.get("/v1/installments", validate("query", installmentsQuery), async (c) => {
			const from = c.req.valid("query").from ?? monthOf(toLocalDate(now()));
			const groups = await activeInstallments(stores, from);
			return c.json({
				from,
				groups: groups.map((g) => ({ ...g, installments: g.installments.map(toTransactionDto) })),
			});
		});
}
