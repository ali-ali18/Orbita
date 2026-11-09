import { createMemoryStores, type Stores, type TransactionRecord } from "@orbita/db";
import { describe, expect, it } from "vitest";
import { CLIENT_ID, CLIENT_SECRET, fakePluggy } from "./fake-pluggy.ts";
import { mapPluggyTransaction } from "./mapping.ts";
import { ACCOUNTS, ITEMS, REAL_NOW, realPluggyOptions } from "./real-data.fixture.ts";
import { syncPluggy } from "./sync.ts";

/*
 * Sync de ponta a ponta com dados FICTÍCIOS no formato do MeuPluggy (4 conexões, todas `isOpenFinance = false`), com as
 * respostas fake da Pluggy no formato do SDK. Os asserts descrevem o comportamento CORRETO; cada um nasceu de um erro
 * visto em dados desse conector (ver docs/pluggy.md, "O que vimos nos dados reais").
 */

const LABELS: Array<[string, string]> = [
	[ITEMS.inter, "Inter"],
	[ITEMS.mp, "Mercado Pago"],
	[ITEMS.santander, "Santander"],
	[ITEMS.nubank, "Nubank"],
];

async function run(options = realPluggyOptions(), now = REAL_NOW, stores?: Stores) {
	const s = stores ?? createMemoryStores({ now: () => now });
	for (const [id, label] of LABELS) {
		if (!(await s.pluggyConnections.list()).some((c) => c.id === id)) {
			await s.pluggyConnections.add({ id, label });
		}
	}
	const { itemId: _itemId, ...pluggy } = options;
	const fake = fakePluggy(pluggy);
	const result = await syncPluggy({
		stores: s,
		readSecret: async (name) =>
			({ pluggy_client_id: CLIENT_ID, pluggy_client_secret: CLIENT_SECRET })[name] ?? null,
		fetch: fake.fetch,
		now: () => now,
	});
	return { stores: s, result };
}

const all = (stores: Stores) => stores.transactions.listRecent({ limit: 500 });
const named = (txs: readonly TransactionRecord[], text: string, date?: string) =>
	txs.filter((t) => t.description.toLowerCase().includes(text.toLowerCase()) && (!date || t.date === date));
const one = (txs: readonly TransactionRecord[], text: string, date?: string) => {
	const found = named(txs, text, date);
	expect(found, `${text} ${date ?? ""}`).toHaveLength(1);
	return found[0] as TransactionRecord;
};

describe("sync com dados no formato do MeuPluggy (isOpenFinance=false)", () => {
	it("as 4 conexões terminam ok e guardam que não são Open Finance", async () => {
		const { result } = await run();
		expect(result.connections.map((c) => [c.status, c.isOpenFinance])).toEqual([
			["ok", false],
			["ok", false],
			["ok", false],
			["ok", false],
		]);
	});

	it("1+2. crédito no cartão que é pagamento de fatura NUNCA vira estorno nem abate gasto, seja qual for o rótulo", async () => {
		const { stores } = await run();
		const txs = await all(stores);
		// Inter "PAGAMENTO ON LINE" (op PAGAMENTO, categoria Shopping), Santander "PAGAMENTO DE FATURA" (op PAGAMENTO,
		// Credit card payment), Nubank/Mercado Pago "Pagamento recebido" (op PAGAMENTO_FATURA): nenhum entra no Órbita.
		expect(txs.filter((t) => t.kind === "refund")).toEqual([]);
		for (const text of ["pagamento on line", "pagamento recebido"]) {
			expect(named(txs, text).filter((t) => t.accountId === null)).toEqual([]);
		}
		expect(named(txs, "PAGAMENTO DE FATURA").filter((t) => t.accountId === null)).toEqual([]);
	});

	it("2. op PAGAMENTO também é compra no cartão: a direção decide (débito = gasto)", async () => {
		const { stores } = await run();
		const txs = await all(stores);
		for (const text of ["kabum", "anthropic", "kiwify", "steam", "CONTA VIVO"]) {
			for (const t of named(txs, text).filter((x) => x.cardId !== null)) {
				expect(t.kind, text).toBe("expense");
			}
		}
		expect(txs.filter((t) => /kabum/i.test(t.description)).map((t) => t.kind)).toEqual([
			"expense",
			"expense",
		]);
	});

	it("3. Rendimentos do Mercado Pago (op RESGATE_APLIC_FINANCEIRA, 'Proceeds interests and dividends') são receita, não resgate", async () => {
		const { stores } = await run();
		const txs = await all(stores);
		const rendimentos = named(txs, "Rendimentos");
		expect(rendimentos).toHaveLength(8);
		expect(new Set(rendimentos.map((t) => t.kind))).toEqual(new Set(["income"]));
		// O resgate de verdade ("Resgate - Cdb", op OUTROS, categoria Investments) continua sendo resgate.
		expect(one(txs, "Resgate - Cdb").kind).toBe("redemption");
		expect(one(txs, "REMUNERACAO APLICACAO AUTOMATICA", "2026-11-05").kind).toBe("income");
		// Aplicação (débito B3) não é gasto.
		expect(one(txs, "Nota Bov 29/10").kind).toBe("investment");
	});

	it("4. pagamentos de fatura pelo lado da CONTA viram card_payment do cartão certo, com op e categoria variados", async () => {
		const { stores } = await run();
		const txs = await all(stores);
		const cards = await stores.cards.list();
		const cardOf = (last4: string) => cards.find((c) => c.last4 === last4)?.id;
		const cases: Array<[string, string, string]> = [
			["Pagamento efetuado - Pagamento Fatura", "2026-11-03", "8316"], // Inter: BOLETO, Transfers
			["Pagamento de fatura Cartão de crédito", "2026-10-11", "7054"], // MP: OPERACAO_CREDITO, Transfers
			["PAGAMENTO CARTAO CREDITO BCE", "2026-10-31", "2689"], // Santander: CARTAO, Credit card payment
			["Pagamento de fatura", "2026-11-04", "5172"], // Nubank: OUTROS, Transfers
			["Pagamento de fatura", "2026-10-13", "5172"],
		];
		for (const [text, date, last4] of cases) {
			const t = txs.find((x) => x.description.includes(text) && x.date === date && x.accountId !== null);
			expect(t?.kind, `${text} ${date}`).toBe("card_payment");
			expect(t?.cardId, `${text} ${date}`).toBe(cardOf(last4));
		}
		// O Mercado Pago pagou 296,76 antes de a fatura fechar = a soma das 2 compras PENDING (173,74 + 123,02): casa pela
		// fatura aberta do cartão do mesmo banco, não vira "cartão não conectado" nem gasto.
		const mp = one(txs, "Pagamento de fatura Cartão de crédito", "2026-11-07");
		expect(mp).toMatchObject({ kind: "card_payment", cardId: cardOf("7054"), amountCents: 29676 });
		// Nenhum pagamento de fatura sobra como despesa.
		expect(txs.filter((t) => t.kind === "expense" && /fatura/i.test(t.description))).toEqual([]);
	});

	it("5. titularidade, Pix a terceiro e aplicação", async () => {
		const { stores } = await run();
		const txs = await all(stores);
		const transferencias = (await stores.categories.getBySlug("transferencias"))?.id;
		// "Same person transfer" = transferência própria, nas duas pontas, entre bancos.
		for (const [text, date] of [
			["Pix enviado - Fulano", "2026-11-07"],
			["Pix recebido FULANO", "2026-11-07"],
			["PIX ENVIADO Fulano", "2026-11-07"],
			["PIX ENVIADO Fulano de Tal", "2026-10-31"],
		] as const) {
			for (const t of named(txs, text, date)) expect(t.kind, `${text} ${date}`).toBe("transfer");
		}
		// Pix a terceiros: gasto (Associação Exemplo = faculdade, Loja Digital Exemplo = serviço, Beltrano = pessoa).
		expect(one(txs, "ASSOCIACAO EDUCACIONAL", "2026-11-02")).toMatchObject({
			kind: "expense",
			amountCents: 59406,
		});
		expect(one(txs, "Loja Digital Exemplo", "2026-11-06")).toMatchObject({
			kind: "expense",
			amountCents: 7950,
		});
		expect(one(txs, "Beltrano Silva")).toMatchObject({ kind: "expense", categoryId: transferencias });
		// Pix do salário é receita.
		expect(one(txs, "Empresa Exemplo").kind).toBe("income");
	});

	it("6. valores com 4 casas arredondam sem lançar; fatura negativa ou irrisória não quebra", async () => {
		const { stores } = await run();
		const nubank = (await stores.cards.list()).find((c) => c.last4 === "5172");
		const bills = await stores.bills.listByCard(nubank?.id ?? "");
		expect(bills).toHaveLength(13);
		const byDue = new Map(bills.map((b) => [b.dueDate, b.totalAmountCents]));
		expect(byDue.get("2026-11-10")).toBe(143884); // 1438.8426
		expect(byDue.get("2026-10-13")).toBe(105586); // 1055.8631
		expect(byDue.get("2026-05-11")).toBe(0); // 0.0043
		expect(Object.is(byDue.get("2025-11-10"), -0)).toBe(false); // -0.0025 não vira -0
		expect(byDue.get("2025-11-10") ?? 0).toBeLessThanOrEqual(0);
		expect(bills.find((b) => b.dueDate === "2026-11-10")?.minimumPaymentCents).toBe(21582);
	});

	it("8. dias de fechamento e vencimento vêm das faturas (creditData traz fecha null)", async () => {
		const { stores } = await run();
		const cards = await stores.cards.list();
		const by = (last4: string) => cards.find((c) => c.last4 === last4);
		expect(by("8316")).toMatchObject({
			closingDay: 5,
			dueDay: 12,
			limitCents: 1132000,
			availableCents: 1070200,
			balanceCents: 61800,
		});
		expect(by("5172")).toMatchObject({
			closingDay: 3,
			dueDay: 10,
			limitCents: 1390000,
			availableCents: 524408,
			balanceCents: 55592,
		});
		expect(by("2689")).toMatchObject({
			closingDay: 30,
			dueDay: 7,
			limitCents: 1154000,
			availableCents: 1046534,
			balanceCents: 107466,
		});
		expect(by("7054")).toMatchObject({
			closingDay: 5,
			limitCents: 1400000,
			availableCents: 1226260,
			balanceCents: 173740,
		});
		expect(cards.map((c) => c.name).sort()).toEqual([
			"Inter",
			"Mercado Pago",
			"Nubank",
			"Santander FREE VISA",
		]);
	});

	it("9. compra PENDING cai na fatura certa: pelo fechamento, sem confiar no billForecastDate do MeuPluggy", async () => {
		const { stores } = await run();
		const txs = await all(stores);
		const pendingOf = (last4: string, cards: Awaited<ReturnType<Stores["cards"]["list"]>>) =>
			txs.filter((t) => t.bankPending && t.cardId === cards.find((c) => c.last4 === last4)?.id);
		const cards = await stores.cards.list();
		// Santander (fecha 30): as 9 compras de 30/10 a 04/11 são da fatura que fecha 30/11 e vence 07/12 (o forecast
		// "2026-11" delas é o mês do fechamento, não do vencimento). A fatura de 07/11 (783,26) já está paga.
		const santander = pendingOf("2689", cards);
		expect(santander).toHaveLength(9);
		expect(new Set(santander.map((t) => t.invoiceMonth))).toEqual(new Set(["2026-12"]));
		expect(santander.reduce((sum, t) => sum + t.amountCents, 0)).toBe(102086);
		// Mercado Pago: as 2 pendentes (post 05/11) são da fatura que fechou 05/11 (vence em novembro): 296,76.
		const mp = pendingOf("7054", cards);
		expect(new Set(mp.map((t) => t.invoiceMonth))).toEqual(new Set(["2026-11"]));
		expect(mp.reduce((sum, t) => sum + t.amountCents, 0)).toBe(29676);
		// Inter: KABUM 5/10 (post 08/11, depois do fechamento de 05/11) é da fatura de dezembro (o forecast dizia 2026-11).
		expect(pendingOf("8316", cards).map((t) => [t.description, t.invoiceMonth])).toEqual([
			["MLP KABUM-KABUM CIDADE BRA", "2026-12"],
		]);
		// Nubank (fecha 03): Farmácia (05/11) e Centauro (03/11, dia do fechamento = próxima) caem em dezembro.
		expect(new Set(pendingOf("5172", cards).map((t) => t.invoiceMonth))).toEqual(new Set(["2026-12"]));
	});

	it("11. parcelas: grupo n/N certo e a pendente não duplica quando vira POSTED", async () => {
		const first = await run();
		const groups = await first.stores.transactions.listInstallmentGroups("2025-01");
		const shape = (g: (typeof groups)[number]) => [
			g.installments[0]?.description.toLowerCase().slice(0, 8),
			g.installments.map((t) => t.installmentNumber),
			g.installments[0]?.installmentCount,
		];
		expect(groups.map(shape).sort()).toEqual(
			[
				["centauro", [4], 6],
				["kiwify c", [12], 12],
				["mercadol", [10, 11], 21],
				["mlp kabu", [4, 5], 10],
				["pag stea", [3], 3],
			].sort(),
		);
		const kabum = groups.find((g) => g.installments[0]?.description.toLowerCase().startsWith("mlp kabum"));
		expect(kabum?.installments.map((t) => [t.installmentNumber, t.budgetMonth])).toEqual([
			[4, "2026-10"],
			[5, "2026-11"],
		]);

		// A KABUM 5/10 vira POSTED (mesmo id) com billId numa fatura nova; mais tarde, sem duplicar.
		const options = realPluggyOptions();
		const card = options.transactions?.[ACCOUNTS.interCard] ?? [];
		const posted = card.map((t) =>
			t.id === "ic-01"
				? {
						...t,
						status: "POSTED",
						creditCardMetadata: {
							...(t.creditCardMetadata as object),
							billId: "inter-nova-1212",
							billForecastDate: null,
						},
					}
				: t,
		);
		(options.transactions ?? {})[ACCOUNTS.interCard] = posted;
		options.bills = {
			...options.bills,
			[ACCOUNTS.interCard]: [
				{
					id: "inter-nova-1212",
					dueDate: "2026-12-12T00:00:00.000Z",
					billClosingDate: "2026-12-05T00:00:00.000Z",
					totalAmount: 103,
					totalAmountCurrencyCode: "BRL",
					minimumPaymentAmount: null,
					payments: [],
				},
				...(options.bills?.[ACCOUNTS.interCard] ?? []),
			],
		};
		const second = await run(options, new Date("2026-12-14T12:00:00Z"), first.stores);
		expect(second.result.connections[0]?.status).toBe("ok");
		const after = await all(first.stores);
		const kabumRows = after.filter((t) => t.description.toLowerCase().startsWith("mlp kabum"));
		expect(kabumRows).toHaveLength(2);
		const five = kabumRows.find((t) => t.installmentNumber === 5);
		expect(five).toMatchObject({ bankPending: false, invoiceMonth: "2026-12", budgetMonth: "2026-11" });
	});

	it("rodar duas vezes não duplica nada", async () => {
		const first = await run();
		const before = (await all(first.stores)).length;
		await run(realPluggyOptions(), REAL_NOW, first.stores);
		expect((await all(first.stores)).length).toBe(before);
	});
});

describe("mapPluggyTransaction: crédito no cartão", () => {
	const ctx = {
		accountType: "CREDIT" as const,
		accountId: null,
		card: { id: "card-1", config: { closingDay: 5, dueDay: 12 } },
		isOpenFinance: false,
	};
	const credit = (extra: Record<string, unknown>) =>
		({
			id: "x",
			description: "Algo",
			currencyCode: "BRL",
			amount: -50,
			date: "2026-10-07T00:00:00.000Z",
			type: "CREDIT",
			status: "POSTED",
			...extra,
		}) as Parameters<typeof mapPluggyTransaction>[0];

	it("pagamento de fatura, com qualquer rótulo, é ignorado", () => {
		for (const extra of [
			{ description: "PAGAMENTO ON LINE", operationType: "PAGAMENTO", category: "Shopping" },
			{ description: "PAGAMENTO DE FATURA", operationType: "PAGAMENTO", category: "Credit card payment" },
			{
				description: "Pagamento recebido",
				operationType: "PAGAMENTO_FATURA",
				category: "Credit card payment",
			},
			{ description: "Qualquer coisa", operationType: "PAGAMENTO", category: "Credit card payment" },
		]) {
			expect(mapPluggyTransaction(credit(extra), ctx)).toEqual({ action: "skip", reason: "card_payment" });
		}
	});

	it("crédito casado com um pagamento de /bills (valor e dia, um a um) é a baixa, com qualquer rótulo", () => {
		const matched = new Map([["x", { cardId: "card-1", amountCents: 5000, date: "2026-10-07" as const }]]);
		expect(
			mapPluggyTransaction(credit({ description: "Crédito", category: "Shopping" }), {
				...ctx,
				billPaymentMatches: matched,
			}),
		).toEqual({ action: "skip", reason: "card_payment" });
		// Sem o casamento, um crédito sem texto de pagamento é estorno.
		expect(mapPluggyTransaction(credit({ description: "Crédito", category: "Shopping" }), ctx).action).toBe(
			"refund",
		);
	});

	it("estorno de verdade continua estorno, mesmo com op PAGAMENTO", () => {
		for (const extra of [
			{ description: "Estorno Amazon", operationType: "PAGAMENTO", category: "Shopping" },
			{ description: "Crédito", operationType: "ESTORNO", category: "Shopping" },
			{ description: "Cashback", operationType: "CASHBACK" },
		]) {
			expect(mapPluggyTransaction(credit(extra), ctx).action).toBe("refund");
		}
	});

	it("débito com op PAGAMENTO é compra", () => {
		const mapped = mapPluggyTransaction(
			credit({ type: "DEBIT", amount: 51.5, operationType: "PAGAMENTO", description: "PAGAMENTO IFOOD" }),
			ctx,
		);
		expect(mapped).toMatchObject({ action: "upsert", input: { kind: "expense" } });
	});
});
