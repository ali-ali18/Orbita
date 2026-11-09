import { describe, expect, it } from "vitest";
import { tx } from "./fake-pluggy.ts";
import { mapPluggyTransaction, type TransactionContext } from "./mapping.ts";
import { transactionSchema } from "./schemas.ts";

/*
 * PENDING (docs.pluggy.ai/docs/transactions, propriedade `status`; docs.pluggy.ai/docs/credit-card-installments, "The
 * lifecycle of a card transaction"): toda compra da fatura aberta chega PENDING e sem billId.
 */

const parse = (extra: Record<string, unknown>) => transactionSchema.parse(tx("t-1", extra));

// Fecha dia 10, vence dia 17.
const card: TransactionContext = {
	accountType: "CREDIT",
	accountId: null,
	card: { id: "card-1", config: { closingDay: 10, dueDay: 17, closingRule: "closing-day-next" } },
	categoryIds: new Map([["outros", "cat-outros"]]),
};
const bank: TransactionContext = { accountType: "BANK", accountId: "acc-1", card: null };

describe("compra PENDING no cartão", () => {
	it("vira despesa marcada como pendente no banco, pela data da compra", () => {
		const mapped = mapPluggyTransaction(
			parse({ status: "PENDING", amount: 89.9, description: "Livraria", date: "2026-11-09T00:00:00.000Z" }),
			card,
		);
		expect(mapped).toMatchObject({
			action: "upsert",
			externalId: "t-1",
			input: {
				kind: "expense",
				amountCents: 8990,
				date: "2026-11-09",
				budgetMonth: "2026-11",
				cardId: "card-1",
				// Fecha dia 10: a compra do dia 9 cai na fatura de novembro (vence dia 17).
				invoiceMonth: "2026-11",
				bankPending: true,
				// NÃO é o "Para revisar" do Órbita: continua confirmado e conta no gasto.
				status: "confirmed",
			},
		});
	});

	it("usa a fatura prevista pelo banco (billForecastDate) quando vem; sem ela, o cálculo pelo fechamento", () => {
		const base = { status: "PENDING", date: "2026-11-09T00:00:00.000Z" };
		expect(
			mapPluggyTransaction(parse({ ...base, creditCardMetadata: { billForecastDate: "2026-12" } }), card),
		).toMatchObject({ input: { invoiceMonth: "2026-12" }, invoiceFromBill: true });
		// Valor torto no campo não derruba nada: vale o cálculo.
		expect(
			mapPluggyTransaction(parse({ ...base, creditCardMetadata: { billForecastDate: "dezembro" } }), card),
		).toMatchObject({ input: { invoiceMonth: "2026-11" } });
	});

	it("o billId (mês do vencimento da fatura) vale mais que a previsão", () => {
		const mapped = mapPluggyTransaction(
			parse({ status: "POSTED", creditCardMetadata: { billId: "bill-1", billForecastDate: "2026-12" } }),
			{ ...card, billMonths: new Map([["bill-1", "2027-01"]]) },
		);
		expect(mapped).toMatchObject({ input: { invoiceMonth: "2027-01", bankPending: false } });
	});

	it("o dia da compra (purchaseDate) pesa no mês da compra também na pendente", () => {
		const mapped = mapPluggyTransaction(
			parse({
				status: "PENDING",
				date: "2026-12-02T00:00:00.000Z",
				creditCardMetadata: { purchaseDate: "2026-11-29T00:00:00.000Z" },
			}),
			card,
		);
		expect(mapped).toMatchObject({
			input: { date: "2026-11-29", budgetMonth: "2026-11", bankPending: true },
		});
	});

	it("crédito PENDING no cartão (estorno ou baixa ainda não lançados) espera efetivar", () => {
		expect(mapPluggyTransaction(parse({ status: "PENDING", type: "CREDIT", amount: -30 }), card)).toEqual({
			action: "skip",
			reason: "pending",
		});
	});
});

describe("PENDING na conta", () => {
	it("agendado ou em processamento não conta como gasto ainda", () => {
		for (const date of ["2026-11-20T00:00:00.000Z", "2026-11-10T00:00:00.000Z"]) {
			expect(mapPluggyTransaction(parse({ status: "PENDING", date }), bank)).toEqual({
				action: "skip",
				reason: "pending",
			});
		}
	});
});
