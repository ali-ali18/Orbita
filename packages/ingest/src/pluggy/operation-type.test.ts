import { describe, expect, it } from "vitest";
import { bankAccount, tx } from "./fake-pluggy.ts";
import { mapPluggyTransaction, type TransactionContext } from "./mapping.ts";
import { transactionSchema } from "./schemas.ts";

/*
 * `operationType` (e `creditCardMetadata.feeType/otherCreditsType`) é o sinal primário do tipo do lançamento
 * (docs.pluggy.ai/docs/transactions, propriedade `operationType`; docs.pluggy.ai/reference/transactions-list).
 * Categoria e nome só valem sem esse sinal.
 */

const parse = (extra: Record<string, unknown>) => transactionSchema.parse(tx("t-1", extra));
void bankAccount;

const ids = new Map([
	["investimentos", "cat-inv"],
	["outros", "cat-outros"],
]);
const bank: TransactionContext = { accountType: "BANK", accountId: "acc-1", card: null, categoryIds: ids };
const card: TransactionContext = {
	accountType: "CREDIT",
	accountId: null,
	card: { id: "card-1", config: { closingDay: 10, dueDay: 17, closingRule: "closing-day-next" } },
	categoryIds: ids,
	billsUnavailable: false,
};

describe("operationType decide o tipo", () => {
	it("PAGAMENTO_FATURA no cartão é a baixa da fatura, mesmo com descrição e categoria de compra", () => {
		const mapped = mapPluggyTransaction(
			parse({
				type: "CREDIT",
				amount: -500,
				description: "Loja do Zé",
				category: "Shopping",
				operationType: "PAGAMENTO_FATURA",
			}),
			card,
		);
		expect(mapped).toEqual({ action: "skip", reason: "card_payment" });
	});

	it("a baixa 'Pagamento recebido' que a Pluggy monta traz PAGAMENTO_FATURA e não precisa das faturas", () => {
		const mapped = mapPluggyTransaction(
			parse({
				type: "CREDIT",
				amount: -830.1,
				description: "Pagamento recebido",
				operationType: "PAGAMENTO_FATURA",
			}),
			{ ...card, billsUnavailable: true },
		);
		expect(mapped).toEqual({ action: "skip", reason: "card_payment" });
	});

	it("PAGAMENTO_FATURA que saiu da conta vira pagamento de fatura (cartão ligado pelo valor)", () => {
		const mapped = mapPluggyTransaction(
			parse({
				amount: -830.1,
				description: "Pgto Cartao",
				category: "Transfers",
				operationType: "PAGAMENTO_FATURA",
			}),
			{ ...bank, billsUnavailable: false, billTotals: [{ cardId: "card-1", amountCents: 83_010 }] },
		);
		expect(mapped).toMatchObject({ action: "upsert", input: { kind: "card_payment", cardId: "card-1" } });
	});

	it("ESTORNO e CASHBACK no cartão são estorno (crédito que abate), mesmo se a descrição diz 'pagamento'", () => {
		for (const operationType of ["ESTORNO", "CASHBACK"]) {
			const mapped = mapPluggyTransaction(
				parse({ type: "CREDIT", amount: -20, description: "Pagamento recebido promoção", operationType }),
				{ ...card, billsUnavailable: true },
			);
			expect(mapped).toMatchObject({ action: "refund", input: { kind: "refund", cardId: "card-1" } });
		}
	});

	it("operationType que não é pagamento impede a descrição de virar pagamento (o plano B só vale sem sinal)", () => {
		const text = {
			type: "CREDIT",
			amount: -10,
			description: "Pagamento de fatura",
			category: "Credit card payment",
		};
		expect(mapPluggyTransaction(parse({ ...text, operationType: null }), card)).toEqual({
			action: "skip",
			reason: "card_payment",
		});
		expect(mapPluggyTransaction(parse({ ...text, operationType: "ESTORNO" }), card)).toMatchObject({
			action: "refund",
		});
	});

	it("RESGATE_APLIC_FINANCEIRA que entrou é resgate (nem renda nem gasto), mesmo com categoria de salário", () => {
		const mapped = mapPluggyTransaction(
			parse({
				type: "CREDIT",
				amount: 1000,
				description: "Crédito",
				category: "Salary",
				operationType: "RESGATE_APLIC_FINANCEIRA",
			}),
			bank,
		);
		expect(mapped).toMatchObject({
			action: "upsert",
			input: { kind: "redemption", categoryId: "cat-inv", amountCents: 100_000 },
		});
	});

	it("RESGATE_APLIC_FINANCEIRA com categoria de rendimento: só é receita se a descrição diz rendimento; resgate de principal não", () => {
		const resgate = (description: string) =>
			mapPluggyTransaction(
				parse({
					type: "CREDIT",
					amount: 5000,
					description,
					category: "Proceeds interests and dividends",
					operationType: "RESGATE_APLIC_FINANCEIRA",
				}),
				bank,
			);
		expect(resgate("Resgate de investimento")).toMatchObject({ input: { kind: "redemption" } });
		expect(resgate("Rendimentos")).toMatchObject({ input: { kind: "income" } });
		expect(resgate("Remuneração do dia")).toMatchObject({ input: { kind: "income" } });
	});

	it("RENDIMENTO_APLIC_FINANCEIRA que entrou é rendimento (receita), mesmo com categoria genérica", () => {
		const mapped = mapPluggyTransaction(
			parse({
				type: "CREDIT",
				amount: 12.5,
				description: "Crédito",
				category: "Transfers",
				operationType: "RENDIMENTO_APLIC_FINANCEIRA",
			}),
			bank,
		);
		expect(mapped).toMatchObject({ action: "upsert", input: { kind: "income", categoryId: "cat-inv" } });
	});

	it("rendimento ou resgate no sentido errado (saiu da conta) não decide: segue o plano B", () => {
		const mapped = mapPluggyTransaction(
			parse({
				amount: -50,
				description: "Mercado",
				category: "Groceries",
				operationType: "RESGATE_APLIC_FINANCEIRA",
			}),
			bank,
		);
		expect(mapped).toMatchObject({ action: "upsert", input: { kind: "expense" } });
	});

	it("PIX, TED e OUTROS não decidem nada: a categoria e o nome continuam valendo", () => {
		for (const operationType of ["PIX", "TED", "OUTROS", null]) {
			const mapped = mapPluggyTransaction(
				parse({
					type: "CREDIT",
					amount: 8,
					description: "Rendimentos CDB",
					category: "Fixed income",
					operationType,
				}),
				bank,
			);
			expect(mapped).toMatchObject({ action: "upsert", input: { kind: "income", categoryId: "cat-inv" } });
		}
	});

	it("TARIFA e feeType marcam a tarifa do cartão na observação; a despesa continua contando", () => {
		const mapped = mapPluggyTransaction(
			parse({
				amount: 40,
				description: "Anuidade",
				operationType: "TARIFA",
				creditCardMetadata: { feeType: "ANNUAL_FEE" },
			}),
			card,
		);
		expect(mapped).toMatchObject({
			action: "upsert",
			input: { kind: "expense", note: "Tarifa do cartão: anuidade.", status: "confirmed" },
		});
	});

	it("crédito contratado no cartão (rotativo, parcelamento da fatura) vai para revisão e continua despesa", () => {
		for (const meta of [{ otherCreditsType: "REVOLVING_CREDIT" }, { otherCreditsType: "BILL_INSTALLMENT" }]) {
			const mapped = mapPluggyTransaction(
				parse({
					amount: 300,
					description: "Juros rotativo",
					operationType: "OPERACOES_CREDITO_CONTRATADAS_CARTAO",
					creditCardMetadata: meta,
				}),
				card,
			);
			expect(mapped).toMatchObject({
				action: "upsert",
				input: { kind: "expense", status: "pending", note: expect.stringContaining("Crédito contratado") },
			});
		}
	});

	it("guarda providerId e providerCode do banco no lançamento", () => {
		const mapped = mapPluggyTransaction(parse({ providerId: "prov-1", providerCode: "nsu-1" }), bank);
		expect(mapped).toMatchObject({
			action: "upsert",
			input: { providerId: "prov-1", providerCode: "nsu-1", bankPending: false },
		});
	});

	it("valor estranho em operationType/providerId vira null e não derruba o lançamento", () => {
		const parsed = transactionSchema.parse(tx("t-9", { operationType: { x: 1 }, providerId: 42 }));
		expect(parsed.operationType).toBeNull();
		expect(parsed.providerId).toBeNull();
	});
});
