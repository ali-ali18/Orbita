import { describe, expect, it } from "vitest";
import { BANK_ACCOUNT_ID, bankAccount, cardAccount, tx } from "./fake-pluggy.ts";
import {
	assignBillPayments,
	mapPluggyAccount,
	mapPluggyTransaction,
	pluggyDateToLocal,
	type TransactionContext,
} from "./mapping.ts";
import { accountSchema, transactionSchema } from "./schemas.ts";

const account = (extra: object = {}) => accountSchema.parse({ ...bankAccount, ...extra });
const card = (extra: object = {}) => accountSchema.parse({ ...cardAccount, ...extra });
const parse = (extra: Record<string, unknown>) => transactionSchema.parse(tx("t-1", extra));

const bankCtx: TransactionContext = {
	accountType: "BANK",
	accountId: "acc-1",
	card: null,
};
// Fecha dia 10 (compra no dia 10 já vai para a seguinte), vence dia 17.
const cardCtx: TransactionContext = {
	accountType: "CREDIT",
	accountId: null,
	card: { id: "card-1", config: { closingDay: 10, dueDay: 17, closingRule: "closing-day-next" } },
};

describe("pluggyDateToLocal", () => {
	it("meia-noite UTC é um dia, não um instante: não recua para o dia anterior em São Paulo", () => {
		expect(pluggyDateToLocal("2026-11-03T00:00:00.000Z")).toBe("2026-11-03");
		expect(pluggyDateToLocal("2026-11-03T00:00:00Z")).toBe("2026-11-03");
		expect(pluggyDateToLocal("2026-11-03")).toBe("2026-11-03");
	});
	it("outro instante vira o dia em America/Sao_Paulo", () => {
		expect(pluggyDateToLocal("2026-11-04T01:30:00.000Z")).toBe("2026-11-03"); // 22:30 em SP
		expect(pluggyDateToLocal("2026-11-03T15:00:00.000Z")).toBe("2026-11-03");
		expect(pluggyDateToLocal("2026-11-03T23:30:00-03:00")).toBe("2026-11-03");
	});
	it("lixo vira null", () => {
		for (const bad of ["", "ontem", "2026-02-30", "2026-02-30T00:00:00.000Z"]) {
			expect(pluggyDateToLocal(bad)).toBeNull();
		}
	});
});

describe("mapPluggyAccount", () => {
	it("conta BANK vira Account ligada ao id do Pluggy, com o nome do banco", () => {
		expect(mapPluggyAccount(account(), "Nubank")).toEqual({
			kind: "account",
			externalId: BANK_ACCOUNT_ID,
			input: {
				name: "Nubank Conta Corrente",
				kind: "checking",
				source: "pluggy",
				externalId: BANK_ACCOUNT_ID,
			},
		});
		const savings = mapPluggyAccount(account({ subtype: "SAVINGS_ACCOUNT" }), null);
		expect(savings).toMatchObject({ kind: "account", input: { name: "Conta Corrente", kind: "savings" } });
	});

	it("conta CREDIT vira Card com fechamento, vencimento, limite e final", () => {
		const mapped = mapPluggyAccount(card(), "Nubank");
		expect(mapped).toMatchObject({
			kind: "card",
			input: {
				name: "Nubank Mastercard Gold",
				last4: "4321",
				closingDay: 10,
				dueDay: 17,
				limitCents: 500_000,
				source: "pluggy",
			},
		});
	});

	it("cartão sem datas de fatura, moeda estrangeira e tipos desconhecidos são ignorados com motivo", () => {
		expect(mapPluggyAccount(card({ creditData: { creditLimit: 100 } }))).toMatchObject({ kind: "ignored" });
		expect(mapPluggyAccount(account({ currencyCode: "USD" }))).toMatchObject({ kind: "ignored" });
		expect(mapPluggyAccount(account({ type: "INVESTMENT" }))).toMatchObject({ kind: "ignored" });
	});

	it("nome grande é cortado em 60 letras", () => {
		const mapped = mapPluggyAccount(account({ name: "x".repeat(200) }), "Banco");
		expect(mapped.kind === "account" && mapped.input.name.length).toBe(60);
	});
});

describe("mapPluggyTransaction: conta", () => {
	it("débito é despesa; crédito é receita; valor em centavos inteiros e positivo", () => {
		expect(mapPluggyTransaction(parse({ amount: -45.9 }), bankCtx)).toMatchObject({
			action: "upsert",
			externalId: "t-1",
			input: {
				kind: "expense",
				amountCents: 4590,
				date: "2026-11-03",
				description: "Padaria",
				accountId: "acc-1",
				status: "confirmed",
			},
		});
		expect(mapPluggyTransaction(parse({ type: "CREDIT", amount: 3200 }), bankCtx)).toMatchObject({
			action: "upsert",
			input: { kind: "income", amountCents: 320_000, accountId: "acc-1" },
		});
	});

	it("o float do Pluggy não estraga o centavo (0.1 + 0.2, 1.15, 4.35)", () => {
		for (const [amount, cents] of [
			[0.1 + 0.2, 30],
			[1.15, 115],
			[4.35, 435],
			[-19.99, 1999],
			[1234567.89, 123_456_789],
		] as const) {
			expect(mapPluggyTransaction(parse({ amount }), bankCtx)).toMatchObject({
				input: { amountCents: cents },
			});
		}
	});

	it("aceita valor como texto decimal", () => {
		expect(mapPluggyTransaction(parse({ amount: "12.34" }), bankCtx)).toMatchObject({
			input: { amountCents: 1234 },
		});
	});

	it("usa a descrição crua quando a limpa vem vazia, e corta em 200 letras", () => {
		expect(mapPluggyTransaction(parse({ description: "" }), bankCtx)).toMatchObject({
			input: { description: "PADARIA SAO JOAO" },
		});
		expect(mapPluggyTransaction(parse({ description: "y".repeat(500) }), bankCtx)).toMatchObject({
			input: { description: "y".repeat(200) },
		});
	});

	it("a data de meia-noite UTC fica no dia, sem recuar", () => {
		expect(mapPluggyTransaction(parse({ date: "2026-11-01T00:00:00.000Z" }), bankCtx)).toMatchObject({
			input: { date: "2026-11-01" },
		});
	});

	it("plano B: pagamento por categoria só liga ao cartão cujo total de fatura bate", () => {
		const payment = parse({ category: "Credit card payment", amount: -830.1 });
		const ctx = { ...bankCtx, billTotals: [{ cardId: "card-1", amountCents: 83_010 }] };
		expect(mapPluggyTransaction(payment, ctx)).toMatchObject({
			action: "upsert",
			input: { kind: "card_payment", accountId: "acc-1", cardId: "card-1", amountCents: 83_010 },
		});
		const skipped = { action: "skip", reason: "card_payment_unlinked" };
		// Sem faturas, total diferente ou dois cartões com o mesmo total: não adivinha.
		expect(mapPluggyTransaction(payment, bankCtx)).toEqual(skipped);
		expect(
			mapPluggyTransaction(payment, { ...bankCtx, billTotals: [{ cardId: "c", amountCents: 1 }] }),
		).toEqual(skipped);
		const both = [
			{ cardId: "card-1", amountCents: 83_010 },
			{ cardId: "card-2", amountCents: 83_010 },
		];
		expect(mapPluggyTransaction(payment, { ...bankCtx, billTotals: both })).toEqual(skipped);
	});

	it("transferência entre contas do próprio dono não é gasto nem receita", () => {
		expect(mapPluggyTransaction(parse({ category: "Same person transfer" }), bankCtx)).toEqual({
			action: "skip",
			reason: "own_transfer",
		});
		expect(mapPluggyTransaction(parse({ category: "Transferência mesma titularidade" }), bankCtx)).toEqual({
			action: "skip",
			reason: "own_transfer",
		});
	});

	it("descarta o que não pode gravar, com motivo", () => {
		expect(mapPluggyTransaction(parse({ status: "PENDING" }), bankCtx)).toEqual({
			action: "skip",
			reason: "pending",
		});
		expect(mapPluggyTransaction(parse({ amount: 0 }), bankCtx)).toEqual({
			action: "skip",
			reason: "invalid",
		});
		expect(mapPluggyTransaction(parse({ type: "OTHER" }), bankCtx)).toEqual({
			action: "skip",
			reason: "invalid",
		});
		expect(mapPluggyTransaction(parse({ date: "ontem-ok" }), bankCtx)).toEqual({
			action: "skip",
			reason: "invalid",
		});
		expect(mapPluggyTransaction(parse({ amount: 99_999_999_999 }), bankCtx)).toEqual({
			action: "skip",
			reason: "invalid",
		});
		expect(mapPluggyTransaction(parse({ currencyCode: "USD" }), bankCtx)).toEqual({
			action: "skip",
			reason: "foreign_currency",
		});
	});

	it("moeda estrangeira com valor convertido usa o convertido", () => {
		expect(
			mapPluggyTransaction(
				parse({ currencyCode: "USD", amount: 10, amountInAccountCurrency: 52.4 }),
				bankCtx,
			),
		).toMatchObject({ input: { amountCents: 5240 } });
	});
});

describe("mapPluggyTransaction: cartão", () => {
	it("compra no cartão leva a fatura calculada pelo engine (fecha dia 10, vence 17)", () => {
		// Antes do fechamento: fatura de novembro (vence 17/11).
		expect(
			mapPluggyTransaction(parse({ date: "2026-11-09T00:00:00.000Z", amount: 100 }), cardCtx),
		).toMatchObject({
			action: "upsert",
			input: { kind: "expense", cardId: "card-1", invoiceMonth: "2026-11", date: "2026-11-09" },
		});
		// No dia do fechamento: já vai para a seguinte.
		expect(
			mapPluggyTransaction(parse({ date: "2026-11-10T00:00:00.000Z", amount: 100 }), cardCtx),
		).toMatchObject({
			input: { invoiceMonth: "2026-12" },
		});
	});

	it("parcela vira lançamento simples, com a parcela na observação", () => {
		const mapped = mapPluggyTransaction(
			parse({
				amount: 250,
				creditCardMetadata: { installmentNumber: 3, totalInstallments: 10, billId: "bill-1" },
			}),
			cardCtx,
		);
		expect(mapped).toMatchObject({
			action: "upsert",
			input: { kind: "expense", amountCents: 25_000, note: "Parcela 3/10" },
		});
		expect((mapped as { input: object }).input).not.toHaveProperty("installmentGroupId");
	});

	it("pagamento recebido no cartão não conta (o lado do banco é quem conta)", () => {
		expect(
			mapPluggyTransaction(
				parse({ type: "CREDIT", amount: -830.1, category: "Credit card payment" }),
				cardCtx,
			),
		).toEqual({ action: "skip", reason: "card_payment" });
		expect(
			mapPluggyTransaction(
				parse({ type: "CREDIT", amount: 830.1, description: "Pagamento recebido", category: null }),
				cardCtx,
			),
		).toEqual({ action: "skip", reason: "card_payment" });
	});

	it("crédito que não é pagamento é estorno; o sync acha a compra original", () => {
		const mapped = mapPluggyTransaction(
			parse({ type: "CREDIT", amount: -45.9, description: "Padaria", date: "2026-11-05T00:00:00.000Z" }),
			cardCtx,
		);
		expect(mapped).toMatchObject({
			action: "refund",
			input: { kind: "refund", cardId: "card-1", amountCents: 4590, invoiceMonth: "2026-11" },
			original: { amountCents: 4590, description: "Padaria", date: "2026-11-05" },
		});
	});
});

describe("mapPluggyTransaction: sinais mais fortes que o nome da categoria", () => {
	const doc = (value: string) => ({ documentNumber: { type: "CPF", value } });

	it("Pix com o mesmo CPF nas duas pontas, ou com o CPF do titular da conta, é transferência própria", () => {
		const same = parse({
			category: null,
			paymentData: { payer: doc("111.222.333-44"), receiver: doc("11122233344") },
		});
		expect(mapPluggyTransaction(same, bankCtx)).toEqual({ action: "skip", reason: "own_transfer" });

		const toOwner = parse({ category: null, paymentData: { receiver: doc("11122233344") } });
		expect(mapPluggyTransaction(toOwner, { ...bankCtx, ownerTaxNumber: "111.222.333-44" })).toEqual({
			action: "skip",
			reason: "own_transfer",
		});
		// Sem saber o CPF do titular, receber de alguém não prova nada.
		expect(mapPluggyTransaction(toOwner, bankCtx)).toMatchObject({ action: "upsert" });
		const other = parse({
			category: null,
			paymentData: { payer: doc("11122233344"), receiver: doc("99988877766") },
		});
		expect(mapPluggyTransaction(other, { ...bankCtx, ownerTaxNumber: "11122233344" })).toMatchObject({
			action: "upsert",
			input: { kind: "expense" },
		});
	});

	it("débito casado com um pagamento da fatura é card_payment do cartão certo", () => {
		const pay = parse({ category: null, description: "Débito automático", amount: -830.1, id: "t-pay" });
		const payment = { cardId: "card-9", amountCents: 83_010, date: "2026-11-05" };
		const ctx = { ...bankCtx, billPaymentMatches: new Map([["t-pay", payment]]) };
		expect(mapPluggyTransaction(pay, ctx)).toMatchObject({
			action: "upsert",
			input: { kind: "card_payment", cardId: "card-9", accountId: "acc-1", amountCents: 83_010 },
		});
		// Sem casamento atribuído a este lançamento, é gasto normal.
		expect(mapPluggyTransaction(pay, bankCtx)).toMatchObject({ input: { kind: "expense" } });
	});

	it("crédito casado com pagamento da fatura daquele cartão não é estorno", () => {
		const credit = parse({
			type: "CREDIT",
			amount: -123.45,
			description: "Crédito",
			category: null,
			id: "t-cr",
		});
		const ctx = {
			...cardCtx,
			billPaymentMatches: new Map([["t-cr", { cardId: "card-1", amountCents: 12_345, date: "2026-11-05" }]]),
		};
		expect(mapPluggyTransaction(credit, ctx)).toEqual({ action: "skip", reason: "card_payment" });
		expect(mapPluggyTransaction(credit, cardCtx)).toMatchObject({ action: "refund" });
	});

	it("faturas indisponíveis: débito da conta e crédito do cartão ficam de fora (não dá para classificar)", () => {
		const skipped = { action: "skip", reason: "bills_unavailable" };
		expect(mapPluggyTransaction(parse({ category: null }), { ...bankCtx, billsUnavailable: true })).toEqual(
			skipped,
		);
		expect(
			mapPluggyTransaction(parse({ type: "CREDIT", amount: -9 }), { ...cardCtx, billsUnavailable: true }),
		).toEqual(skipped);
		// Receita na conta e compra no cartão não dependem das faturas.
		expect(
			mapPluggyTransaction(parse({ type: "CREDIT", amount: 9 }), { ...bankCtx, billsUnavailable: true }),
		).toMatchObject({ input: { kind: "income" } });
		expect(mapPluggyTransaction(parse({ amount: 9 }), { ...cardCtx, billsUnavailable: true })).toMatchObject({
			input: { kind: "expense" },
		});
	});

	it("billId com fatura conhecida define o invoiceMonth; o engine é o plano B", () => {
		// 09/11 cairia na fatura de 2026-11 (fecha dia 10); o Pluggy diz que está na de 2026-12.
		const meta = { billId: "bill-dez" };
		const withBill = parse({ date: "2026-11-09T00:00:00.000Z", creditCardMetadata: meta });
		const ctx = { ...cardCtx, billMonths: new Map([["bill-dez", "2026-12"]]) };
		expect(mapPluggyTransaction(withBill, ctx)).toMatchObject({ input: { invoiceMonth: "2026-12" } });
		expect(mapPluggyTransaction(withBill, cardCtx)).toMatchObject({ input: { invoiceMonth: "2026-11" } });
		const unknown = parse({ date: "2026-11-09T00:00:00.000Z", creditCardMetadata: { billId: "outra" } });
		expect(mapPluggyTransaction(unknown, ctx)).toMatchObject({ input: { invoiceMonth: "2026-11" } });
		// Estorno também.
		const refund = parse({
			type: "CREDIT",
			amount: -5,
			date: "2026-11-09T00:00:00.000Z",
			creditCardMetadata: meta,
		});
		expect(mapPluggyTransaction(refund, ctx)).toMatchObject({
			action: "refund",
			input: { invoiceMonth: "2026-12" },
		});
	});
});

describe("assignBillPayments", () => {
	const pay = (amountCents: number, date: string, cardId = "c") => ({ cardId, amountCents, date });
	const cand = (id: string, amountCents: number, date: string) => ({ id, amountCents, date });

	it("cada pagamento casa com um débito só: o aluguel de mesmo valor 2 dias depois continua gasto", () => {
		const out = assignBillPayments(
			[cand("fatura", 120_000, "2026-11-05"), cand("aluguel", 120_000, "2026-11-07")],
			[pay(120_000, "2026-11-05")],
		);
		expect([...out.keys()]).toEqual(["fatura"]);
	});

	it("prefere o mesmo dia e depois o mais próximo, e vale a ordem inversa da lista", () => {
		const list = [
			cand("longe", 100, "2026-11-08"),
			cand("perto", 100, "2026-11-06"),
			cand("mesmo", 100, "2026-11-05"),
		];
		expect([...assignBillPayments(list, [pay(100, "2026-11-05")]).keys()]).toEqual(["mesmo"]);
		expect([...assignBillPayments(list.slice(0, 2), [pay(100, "2026-11-05")]).keys()]).toEqual(["perto"]);
	});

	it("dois pagamentos iguais consomem dois débitos; o terceiro sobra", () => {
		const out = assignBillPayments(
			[cand("a", 100, "2026-11-05"), cand("b", 100, "2026-11-05"), cand("c", 100, "2026-11-05")],
			[pay(100, "2026-11-05", "x"), pay(100, "2026-11-05", "y")],
		);
		expect([...out.keys()].sort()).toEqual(["a", "b"]);
		expect(new Set([...out.values()].map((p) => p.cardId))).toEqual(new Set(["x", "y"]));
	});

	it("valor diferente ou mais de 3 dias não casa", () => {
		expect(
			assignBillPayments(
				[cand("a", 101, "2026-11-05"), cand("b", 100, "2026-11-09")],
				[pay(100, "2026-11-05")],
			).size,
		).toBe(0);
	});
});
