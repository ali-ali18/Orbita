import { describe, expect, it } from "vitest";
import { buildCategoryIndex } from "./classify.ts";
import { BANK_ACCOUNT_ID, bankAccount, cardAccount, tx } from "./fake-pluggy.ts";
import {
	assignBillPayments,
	isEstimatedCardDates,
	mapPluggyAccount,
	mapPluggyTransaction,
	pluggyDateToLocal,
	resolveCardDates,
	type TransactionContext,
} from "./mapping.ts";
import { accountSchema, billSchema, transactionSchema } from "./schemas.ts";

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
				name: "Nubank",
				last4: "4321",
				closingDay: 10,
				dueDay: 17,
				limitCents: 500_000,
				source: "pluggy",
			},
		});
	});

	it("cartão sem nenhuma data NÃO é descartado: entra com dias padrão marcados como estimados", () => {
		expect(mapPluggyAccount(card({ creditData: { creditLimit: 100 } }))).toMatchObject({
			kind: "card",
			input: { closingDay: 20, dueDay: 27, limitCents: 10_000 },
			dates: { origin: "default" },
		});
	});

	it("moeda estrangeira e tipos desconhecidos são ignorados com motivo", () => {
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

describe("resolveCardDates: fechamento e vencimento do cartão", () => {
	const bill = (extra: object) => billSchema.parse({ id: "b", payments: [], ...extra });
	const noDates = (extra: object = {}) => card({ creditData: { creditLimit: 100, ...extra } });

	it("1) creditData com as duas datas vale mais que tudo", () => {
		const bills = [
			bill({ dueDate: "2026-10-05T00:00:00.000Z", billClosingDate: "2026-09-28T00:00:00.000Z" }),
		];
		expect(resolveCardDates(card(), bills)).toEqual({ closingDay: 10, dueDay: 17, origin: "credit_data" });
	});

	it("2) sem creditData, a fatura mais recente com fechamento e vencimento", () => {
		const bills = [
			bill({ id: "velha", dueDate: "2026-09-05T00:00:00.000Z", billClosingDate: "2026-08-29T00:00:00.000Z" }),
			bill({ id: "nova", dueDate: "2026-11-08T00:00:00.000Z", billClosingDate: "2026-11-01T00:00:00.000Z" }),
		];
		expect(resolveCardDates(noDates(), bills)).toEqual({ closingDay: 1, dueDay: 8, origin: "bill" });
	});

	it("2b) creditData só com o vencimento + fatura completa: usa a fatura", () => {
		const bills = [
			bill({ dueDate: "2026-11-08T00:00:00.000Z", billClosingDate: "2026-11-01T00:00:00.000Z" }),
		];
		expect(resolveCardDates(noDates({ balanceDueDate: "2026-11-20T00:00:00.000Z" }), bills)).toMatchObject({
			closingDay: 1,
			dueDay: 8,
			origin: "bill",
		});
	});

	it("3) só o vencimento (da fatura): fechamento 7 dias antes, atravessando o mês, e marcado como estimado", () => {
		const bills = [bill({ dueDate: "2026-11-03T00:00:00.000Z", billClosingDate: null })];
		const dates = resolveCardDates(noDates(), bills);
		expect(dates).toEqual({ closingDay: 27, dueDay: 3, origin: "due_date_only" });
		expect(isEstimatedCardDates(dates.origin)).toBe(true);
	});

	it("3b) só o vencimento do creditData também serve", () => {
		expect(resolveCardDates(noDates({ balanceDueDate: "2026-11-17T00:00:00.000Z" }), [])).toEqual({
			closingDay: 10,
			dueDay: 17,
			origin: "due_date_only",
		});
	});

	it("4) nada: dias padrão, estimado", () => {
		const dates = resolveCardDates(noDates(), [bill({ dueDate: null })]);
		expect(dates).toEqual({ closingDay: 20, dueDay: 27, origin: "default" });
		expect(isEstimatedCardDates("credit_data")).toBe(false);
		expect(isEstimatedCardDates("bill")).toBe(false);
	});
});

describe("mapPluggyTransaction: classificação pela categoria do Pluggy", () => {
	const ids = new Map([
		["mercado", "cat-mercado"],
		["delivery", "cat-delivery"],
		["saude", "cat-saude"],
		["transferencias", "cat-transferencias"],
		["investimentos", "cat-investimentos"],
		["outros", "cat-outros"],
	]);
	const index = buildCategoryIndex([
		{ id: "03000000", description: "Investments" },
		{ id: "03020000", description: "Fixed income", parentId: "03000000", parentDescription: "Investments" },
		{ id: "10000000", description: "Healthcare" },
		{ id: "10020000", description: "Pharmacy", parentId: "10000000", parentDescription: "Healthcare" },
	]);
	const ctx: TransactionContext = { ...bankCtx, categoryIds: ids, categoryIndex: index };
	const kindOf = (extra: Record<string, unknown>, c = ctx) => {
		const mapped = mapPluggyTransaction(parse(extra), c);
		return mapped.action === "upsert"
			? `${mapped.input.kind}:${mapped.input.categoryId}`
			: mapped.action === "skip"
				? `skip:${mapped.reason}`
				: "refund";
	};

	it("aplicação é gasto em Investimentos; resgate e rendimento são receita nessa categoria", () => {
		expect(kindOf({ category: "Fixed income", categoryId: "03020000", amount: -500 })).toBe(
			"expense:cat-investimentos",
		);
		expect(kindOf({ category: "Fixed income", categoryId: "03020000", type: "CREDIT", amount: 500 })).toBe(
			"income:cat-investimentos",
		);
		// Sem o nome da folha conhecido, o pai da árvore decide.
		expect(kindOf({ category: "Algo novo", categoryId: "03020000", amount: -1 })).toBe(
			"expense:cat-investimentos",
		);
		expect(
			kindOf({ category: "Investimentos", amount: -1 }, { ...ctx, categoryIndex: undefined as never }),
		).toBe("expense:cat-investimentos");
	});

	it("rendimento de investimento entra como receita em Investimentos", () => {
		expect(kindOf({ category: "Interests on investments", type: "CREDIT", amount: 3.2 })).toBe(
			"income:cat-investimentos",
		);
		expect(kindOf({ description: "Rendimentos caixinha", category: null, type: "CREDIT", amount: 3.2 })).toBe(
			"income:cat-investimentos",
		);
	});

	it("plano B pela descrição só com categoria ausente ou genérica", () => {
		expect(kindOf({ description: "Aplicação CDB", category: null, amount: -100 })).toBe(
			"expense:cat-investimentos",
		);
		expect(kindOf({ description: "RESGATE CAIXINHA", category: "Other", type: "CREDIT", amount: 100 })).toBe(
			"income:cat-investimentos",
		);
		expect(kindOf({ description: "Poupança do Zé", category: "Eating out", amount: -100 })).toBe(
			"expense:cat-delivery",
		);
		// Palavra dentro de outra não conta.
		expect(kindOf({ description: "Resgatei meu cachorro", category: null, amount: -10 })).toBe(
			"expense:cat-outros",
		);
	});

	it("despesa vai para a categoria do Órbita pela folha, pelo pai ou cai em Outros", () => {
		expect(kindOf({ category: "Supermarkets", amount: -10 })).toBe("expense:cat-mercado");
		expect(kindOf({ category: "Eating out", amount: -10 })).toBe("expense:cat-delivery");
		expect(kindOf({ category: "Pharmacy", categoryId: "10020000", amount: -10 })).toBe("expense:cat-saude");
		// Folha desconhecida, pai conhecido pela árvore.
		expect(kindOf({ category: "Coisa nova", categoryId: "10020000", amount: -10 })).toBe("expense:cat-saude");
		expect(kindOf({ category: "Online shopping", description: "Compra online", amount: -10 })).toBe(
			"expense:cat-outros",
		);
		expect(kindOf({ category: "Food and drinks", amount: -10 })).toBe("expense:cat-delivery");
		expect(kindOf({ category: "Shopping", description: "iFood", amount: -10 })).toBe("expense:cat-delivery");
		expect(kindOf({ category: null, description: "Cobrança avulsa", amount: -10 })).toBe(
			"expense:cat-outros",
		);
		// Sem categorias carregadas, sem categoria.
		expect(kindOf({ category: "Eating out", amount: -10 }, bankCtx)).toBe("expense:null");
	});

	it("compra no cartão também é categorizada; a receita não leva categoria", () => {
		const c = { ...cardCtx, categoryIds: ids };
		expect(kindOf({ category: "Groceries", amount: 10 }, c)).toBe("expense:cat-mercado");
		expect(kindOf({ category: "Salary", type: "CREDIT", amount: 10 })).toBe("income:null");
	});

	it("pagamento de fatura e mesma titularidade pela árvore", () => {
		const tree = buildCategoryIndex([
			{ id: "05000000", description: "Transfers" },
			{ id: "05090000", description: "Same person transfer", parentId: "05000000" },
		]);
		expect(
			kindOf({ category: "Transfers", categoryId: "05090000", amount: -5 }, { ...ctx, categoryIndex: tree }),
		).toBe("skip:own_transfer");
	});
});

describe("mapPluggyTransaction: prioridade da categoria", () => {
	const ids = new Map([
		["mercado", "cat-mercado"],
		["delivery", "cat-delivery"],
		["transporte", "cat-transporte"],
		["assinaturas", "cat-assinaturas"],
		["saude", "cat-saude"],
		["transferencias", "cat-transferencias"],
		["investimentos", "cat-investimentos"],
		["outros", "cat-outros"],
	]);
	const index = buildCategoryIndex([
		{ id: "10000000", description: "Healthcare" },
		{ id: "10020000", description: "Pharmacy", parentId: "10000000", parentDescription: "Healthcare" },
		{ id: "20000000", description: "Transfers" },
		{ id: "20010000", description: "Transfer - PIX", parentId: "20000000", parentDescription: "Transfers" },
	]);
	const ctx: TransactionContext = { ...cardCtx, categoryIds: ids, categoryIndex: index };
	const pick = (extra: Record<string, unknown>, c: TransactionContext = ctx) => {
		const mapped = mapPluggyTransaction(parse({ amount: 30, ...extra }), c);
		if (mapped.action !== "upsert") throw new Error(`esperava upsert, veio ${mapped.action}`);
		return mapped;
	};

	it("regra do dono vence MCC, CNAE e categoria do Pluggy", () => {
		const c = { ...ctx, categoryRules: [{ pattern: "rei dos lanches", categoryId: "cat-do-dono" }] };
		const m = pick(
			{
				description: "Rei dos Lanches",
				category: "Pharmacy",
				categoryId: "10020000",
				creditCardMetadata: { payeeMCC: 5411 },
				merchant: { cnae: "4771701" },
			},
			c,
		);
		expect(m.input.categoryId).toBe("cat-do-dono");
		expect(m.categorySource).toBe("rule");
	});

	it("regra casa pelo nome do estabelecimento do banco, mesmo com descrição diferente", () => {
		const c = { ...ctx, categoryRules: [{ pattern: "padaria central", categoryId: "cat-do-dono" }] };
		const m = pick({ description: "COMPRA 99887", merchant: { name: "Padaria Central" } }, c);
		expect(m.input.categoryId).toBe("cat-do-dono");
		expect(m.input.merchantName).toBe("Padaria Central");
	});

	it("MCC vence CNAE, que vence a categoria do Pluggy", () => {
		const base = { category: "Pharmacy", categoryId: "10020000" };
		const mcc = pick({ ...base, creditCardMetadata: { payeeMCC: 5812 }, merchant: { cnae: "4771701" } });
		expect([mcc.input.categoryId, mcc.categorySource]).toEqual(["cat-delivery", "mcc"]);
		const cnae = pick({ ...base, creditCardMetadata: { payeeMCC: 9999 }, merchant: { cnae: "4731800" } });
		expect([cnae.input.categoryId, cnae.categorySource]).toEqual(["cat-transporte", "cnae"]);
		const pluggy = pick(base);
		expect([pluggy.input.categoryId, pluggy.categorySource]).toEqual(["cat-saude", "pluggy"]);
	});

	it("MCC como texto também vale", () => {
		const m = pick({ creditCardMetadata: { payeeMCC: "5411" } });
		expect(m.input.categoryId).toBe("cat-mercado");
	});

	it("a descrição categoriza quando o banco só diz que foi Pix", () => {
		const m = pick({
			category: "Transfer - PIX",
			categoryId: "20010000",
			description: "Pix enviado - Netflix",
		});
		expect([m.input.categoryId, m.categorySource]).toEqual(["cat-assinaturas", "pluggy"]);
	});

	it("PIX sem compra conhecida vira Transferências e guarda a categoria do banco", () => {
		const m = pick({ category: "Transfer - PIX", categoryId: "20010000", description: "Pix enviado - Rei" });
		expect([m.input.categoryId, m.categorySource]).toEqual(["cat-transferencias", "pluggy"]);
		expect(m.input.sourceCategory).toBe("Transfers › Transfer - PIX");
	});

	it("sem árvore usa só o nome da categoria do lançamento; sem categoria, sourceCategory é null", () => {
		const noTree = { ...ctx };
		delete (noTree as { categoryIndex?: unknown }).categoryIndex;
		expect(pick({ category: "Shopping", categoryId: null }, noTree).input.sourceCategory).toBe("Shopping");
		expect(pick({ category: null, categoryId: null }, noTree).input.sourceCategory).toBeNull();
	});

	it("regra decide mesmo sem as categorias do Órbita carregadas; sem regra a categoria fica vazia", () => {
		const noIds = { ...ctx };
		delete (noIds as { categoryIds?: unknown }).categoryIds;
		expect(pick({}, noIds).input.categoryId).toBeNull();
		const withRule = { ...noIds, categoryRules: [{ pattern: "padaria", categoryId: "cat-x" }] };
		expect(pick({ description: "Padaria" }, withRule).input.categoryId).toBe("cat-x");
	});

	it("despesa na conta também usa regra e MCC do merchant (CNAE)", () => {
		const c: TransactionContext = { ...bankCtx, categoryIds: ids, categoryRules: [] };
		const m = pick({ description: "Pix enviado - Farmácia", merchant: { cnae: "4771-7/01" } }, c);
		expect(m.input.categoryId).toBe("cat-saude");
	});
});

describe("mapPluggyTransaction: parcelas do cartão", () => {
	const parcel = (n: number, extra: Record<string, unknown> = {}) =>
		parse({
			description: "Geladeira Brastemp",
			amount: 250,
			date: `2026-${String(9 + n).padStart(2, "0")}-20T00:00:00.000Z`,
			creditCardMetadata: {
				installmentNumber: n,
				totalInstallments: 6,
				purchaseDate: "2026-10-20T00:00:00.000Z",
				billId: null,
			},
			...extra,
		});
	const mapped = (t: ReturnType<typeof parcel>, c = cardCtx) => {
		const m = mapPluggyTransaction(t, c);
		if (m.action !== "upsert") throw new Error("esperava upsert");
		return m;
	};

	it("todas as parcelas da mesma compra levam o mesmo grupo; o número e o total vêm do Pluggy", () => {
		const a = mapped(parcel(1));
		const b = mapped(parcel(2));
		expect(a.installment).toMatchObject({ number: 1, count: 6 });
		expect(b.installment).toMatchObject({ number: 2, count: 6 });
		expect(a.installment?.groupId).toBe(b.installment?.groupId);
		expect(a.installment?.groupId).toMatch(/^pluggy-[0-9a-f]{40}$/);
	});

	it("data da compra e mês do orçamento seguem a convenção das parcelas manuais (n-ésima pesa no n-ésimo mês)", () => {
		const p3 = mapped(parcel(3));
		expect(p3.input.date).toBe("2026-10-20");
		expect(p3.input.budgetMonth).toBe("2026-12");
		expect(mapped(parcel(1)).input.budgetMonth).toBe("2026-10");
	});

	it("o número no fim da descrição não muda o grupo ('3/6', 'Parcela 3/6', 'PARC 03/06')", () => {
		const ids = new Set(
			["Geladeira Brastemp 3/6", "Geladeira Brastemp - Parcela 3/6", "GELADEIRA BRASTEMP PARC 03/06"].map(
				(description) => mapped(parcel(3, { description })).installment?.groupId,
			),
		);
		expect(ids.size).toBe(1);
	});

	it("compras diferentes (data, total, cartão ou loja) têm grupos diferentes", () => {
		const base = mapped(parcel(1)).installment?.groupId;
		const other = (t: ReturnType<typeof parcel>, c = cardCtx) => mapped(t, c).installment?.groupId;
		expect(other(parcel(1, { description: "Fogão" }))).not.toBe(base);
		expect(
			other(
				parcel(1, {
					creditCardMetadata: {
						installmentNumber: 1,
						totalInstallments: 6,
						purchaseDate: "2026-10-21T00:00:00.000Z",
					},
				}),
			),
		).not.toBe(base);
		expect(
			other(
				parcel(1, {
					creditCardMetadata: {
						installmentNumber: 1,
						totalInstallments: 10,
						purchaseDate: "2026-10-20T00:00:00.000Z",
					},
				}),
			),
		).not.toBe(base);
		expect(
			other(parcel(1), { ...cardCtx, card: { id: "card-2", config: cardCtx.card?.config as never } }),
		).not.toBe(base);
	});

	it("sem data da compra, parcela única (1x), número fora do total ou total grande demais: lançamento avulso com a nota", () => {
		const noDate = mapped(parcel(2, { creditCardMetadata: { installmentNumber: 2, totalInstallments: 6 } }));
		expect(noDate.installment).toBeUndefined();
		expect(noDate.input.note).toBe("Parcela 2/6");
		const meta = (installmentNumber: number, totalInstallments: number) => ({
			installmentNumber,
			totalInstallments,
			purchaseDate: "2026-10-20T00:00:00.000Z",
		});
		expect(mapped(parcel(1, { creditCardMetadata: meta(1, 1) })).installment).toBeUndefined();
		expect(mapped(parcel(1, { creditCardMetadata: meta(7, 6) })).installment).toBeUndefined();
		expect(mapped(parcel(1, { creditCardMetadata: meta(1, 100) })).installment).toBeUndefined();
	});

	it("compra à vista no cartão não vira parcelamento", () => {
		const m = mapped(parse({ amount: 30, creditCardMetadata: { purchaseDate: "2026-10-20T00:00:00.000Z" } }));
		expect(m.installment).toBeUndefined();
	});

	it("a fatura segue o billId do Pluggy (a parcela cai na fatura que o banco diz)", () => {
		const t = parcel(2, {
			creditCardMetadata: {
				installmentNumber: 2,
				totalInstallments: 6,
				purchaseDate: "2026-10-20T00:00:00.000Z",
				billId: "bill-dez",
			},
		});
		expect(mapped(t, { ...cardCtx, billMonths: new Map([["bill-dez", "2026-12"]]) }).input.invoiceMonth).toBe(
			"2026-12",
		);
	});
});

describe("mapPluggyAccount: nome do cartão", () => {
	it("nome fraco ('G') ganha o banco detectado; nome bom é mantido", () => {
		const weak = mapPluggyAccount(card({ name: "G", marketingName: null }), "MeuPluggy", [], "Nubank");
		expect(weak).toMatchObject({ kind: "card", input: { name: "Nubank", last4: "4321" } });
		const good = mapPluggyAccount(
			card({ name: "Ultravioleta", marketingName: null }),
			"MeuPluggy",
			[],
			"Nubank",
		);
		expect(good).toMatchObject({ kind: "card", input: { name: "Nubank Ultravioleta" } });
		const noBank = mapPluggyAccount(card({ name: "G", marketingName: null }), "MeuPluggy", [], null);
		expect(noBank).toMatchObject({ kind: "card", input: { name: "G" } });
	});
});
