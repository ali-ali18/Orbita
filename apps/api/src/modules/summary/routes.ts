import { monthOf, toLocalDate } from "@orbita/core";
import {
	activeInstallments,
	cardInvoice,
	cashFlow,
	invoicesOverview,
	monthSummary,
	spendingBreakdown,
	spendingDaily,
} from "@orbita/ledger";
import { cardInvoiceParam, installmentsQuery, invoicePayBody, monthParam } from "@orbita/shared";
import { Hono } from "hono";
import { idempotent } from "../../http/idempotency.ts";
import type { ModuleDeps } from "../../http/module-deps.ts";
import type { AppEnv } from "../../http/require-device.ts";
import { validate } from "../../http/validate.ts";
import { toCardDto } from "../cards/dto.ts";
import { toTransactionDto } from "../transactions/dto.ts";
import { payInvoice } from "./pay.ts";

/** Telas de leitura: resumo do mês, fatura do cartão e parcelamentos. Sempre calculadas pelo engine. */
export function routes({ stores, now, requireDevice }: ModuleDeps) {
	return (
		new Hono<AppEnv>()
			.use("/v1/summary/*", requireDevice)
			.use("/v1/cards/:id/invoices/*", requireDevice)
			.use("/v1/installments", requireDevice)
			.use("/v1/invoices/*", requireDevice)
			.use("/v1/cash-flow/*", requireDevice)
			.get("/v1/summary/:month", validate("param", monthParam), async (c) =>
				c.json(await monthSummary(stores, c.req.valid("param").month, toLocalDate(now()))),
			)
			// Diagnóstico do Gasto: cada lançamento que somou, de que ramo veio e quanto. Só leitura, mesma autenticação.
			.get("/v1/summary/:month/breakdown", validate("param", monthParam), async (c) =>
				c.json(await spendingBreakdown(stores, c.req.valid("param").month, toLocalDate(now()))),
			)
			// Gasto dia a dia (acumulado do mês e do anterior), variação e top 3 estabelecimentos: o mesmo Gasto do Início.
			.get("/v1/summary/:month/daily", validate("param", monthParam), async (c) =>
				c.json(await spendingDaily(stores, c.req.valid("param").month, toLocalDate(now()))),
			)
			// Fluxo de caixa: entradas e saídas das contas (não do cartão) no mês, com o pagamento de fatura como saída.
			.get("/v1/cash-flow/:month", validate("param", monthParam), async (c) =>
				c.json(await cashFlow(stores, c.req.valid("param").month)),
			)
			// "Faturas" do Início: o que se deve em cada cartão e no total (aberta mais fechadas sem pagar, menos
			// pagamentos), o limite (banco, com fallback) e a série dos últimos 6 meses.
			.get("/v1/invoices/overview", async (c) => {
				const overview = await invoicesOverview(stores, toLocalDate(now()));
				return c.json({
					owedCents: overview.owedCents,
					nextDueDate: overview.nextDueDate,
					limits: overview.limits,
					history: overview.history,
					cards: overview.cards.map((line) => ({
						card: toCardDto(line.card),
						due: line.due,
						open: line.open,
						owedCents: line.owedCents,
						nextDueDate: line.nextDueDate,
						usedLimitCents: line.usedLimitCents,
						limit: line.limit,
					})),
				});
			})
			.get("/v1/cards/:id/invoices/:month", validate("param", cardInvoiceParam), async (c) => {
				const { id, month } = c.req.valid("param");
				const result = await cardInvoice(stores, id, month, toLocalDate(now()));
				return c.json({
					card: toCardDto(result.card),
					invoice: result.invoice,
					bank: result.bank,
					composition: result.composition,
					transactions: result.transactions.map(toTransactionDto),
				});
			})
			.post(
				"/v1/cards/:id/invoices/:month/pay",
				validate("param", cardInvoiceParam),
				validate("json", invoicePayBody),
				async (c) => {
					const { id, month } = c.req.valid("param");
					const body = c.req.valid("json");
					const result = await idempotent(c, { store: stores.idempotency, now }, body, 201, async () => ({
						transaction: toTransactionDto(
							(
								await payInvoice(stores, {
									cardId: id,
									month,
									accountId: body.accountId,
									today: toLocalDate(now()),
								})
							).transaction,
						),
					}));
					return c.json(result, 201);
				},
			)
			.get("/v1/installments", validate("query", installmentsQuery), async (c) => {
				const from = c.req.valid("query").from ?? monthOf(toLocalDate(now()));
				const groups = await activeInstallments(stores, from, toLocalDate(now()));
				return c.json({
					from,
					groups: groups.map((g) => ({ ...g, installments: g.installments.map(toTransactionDto) })),
				});
			})
	);
}
