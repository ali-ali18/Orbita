import { describe, expect, it } from "vitest";
import { createPluggyClient, type PluggyFetch } from "./client.ts";
import { PluggyError } from "./errors.ts";
import {
	bareInvestment,
	CLIENT_ID,
	CLIENT_SECRET,
	cdbInvestment,
	etfInvestment,
	fakePluggy,
	fundInvestment,
	INV_BARE_ID,
	INV_CDB_ID,
	INV_FUND_ID,
	INV_STOCK_ID,
	ITEM_ID,
	invTx,
	stockInvestment,
} from "./fake-pluggy.ts";
import {
	centsOrNull,
	decimalText,
	readInvestments,
	readInvestmentTransactions,
	toInvestmentMovement,
	toInvestmentPosition,
} from "./investments.ts";

// Tudo aqui é fictício (ver fake-pluggy.ts): nenhum dado real de conta.

const make = (fetch: PluggyFetch) =>
	createPluggyClient({ fetch, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("cliente Pluggy: investimentos", () => {
	it("lista vazia é resposta válida", async () => {
		const fake = fakePluggy();
		expect(await make(fake.fetch).investments(ITEM_ID)).toEqual({ investments: [], dropped: 0 });
		const req = fake.requests.find((r) => r.url.pathname === "/investments");
		expect(req?.url.searchParams.get("itemId")).toBe(ITEM_ID);
		expect(req?.url.searchParams.get("pageSize")).toBe("500");
	});

	it("renda fixa com taxa: centavos inteiros, taxa em texto e datas só com o dia", async () => {
		const fake = fakePluggy({ investments: { [ITEM_ID]: [cdbInvestment] } });
		const { investments } = await make(fake.fetch).investments(ITEM_ID);
		expect(investments).toHaveLength(1);
		const [p] = investments.map(toInvestmentPosition);
		expect(p).toMatchObject({
			externalId: INV_CDB_ID,
			type: "FIXED_INCOME",
			subtype: "CDB",
			name: "CDB Banco Fictício 110% CDI",
			currencyCode: "BRL",
			balanceCents: 1043257,
			grossCents: 1058010,
			investedCents: 1000000,
			profitCents: 43257,
			withdrawableCents: 1043257,
			incomeTaxCents: 14753,
			financialTaxCents: 0,
			rate: "110",
			rateType: "CDI",
			fixedAnnualRate: null,
			quantity: null,
			unitValue: null,
			date: "2026-11-06",
			dueDate: "2028-05-10",
			issueDate: "2026-05-10",
			issuer: "BANCO FICTICIO S/A",
			status: "ACTIVE",
			institutionName: null,
		});
		for (const v of [p?.balanceCents, p?.grossCents, p?.investedCents, p?.profitCents, p?.incomeTaxCents]) {
			expect(Number.isInteger(v)).toBe(true);
		}
	});

	it("fundo com cotas: quantidade e valor da cota como decimal em texto, rendimento ausente fica null", async () => {
		const fake = fakePluggy({ investments: { [ITEM_ID]: [fundInvestment] } });
		const { investments } = await make(fake.fetch).investments(ITEM_ID);
		const [p] = investments.map(toInvestmentPosition);
		expect(p).toMatchObject({
			externalId: INV_FUND_ID,
			type: "MUTUAL_FUND",
			subtype: "MULTIMARKET_FUND",
			code: "11.222.333/0001-81",
			balanceCents: 521033,
			grossCents: 525090,
			investedCents: 500000,
			profitCents: null,
			incomeTaxCents: 4057,
			financialTaxCents: null,
			quantity: "3026.752341",
			unitValue: "1.73482915",
			lastMonthRate: "0.87",
			annualRate: "9.41",
			lastTwelveMonthsRate: "11.2",
			rate: null,
			dueDate: null,
		});
	});

	it("ação e ETF com quantidade", async () => {
		const fake = fakePluggy({ investments: { [ITEM_ID]: [stockInvestment, etfInvestment] } });
		const { investments } = await make(fake.fetch).investments(ITEM_ID);
		const [stock, etf] = investments.map(toInvestmentPosition);
		expect(stock).toMatchObject({
			externalId: INV_STOCK_ID,
			type: "EQUITY",
			subtype: "STOCK",
			code: "EXEM3",
			isin: "BREXEMACNOR1",
			balanceCents: 314500,
			investedCents: 290050,
			profitCents: 24450,
			quantity: "100",
			unitValue: "31.45",
			dueDate: null,
			rateType: null,
		});
		expect(etf).toMatchObject({
			type: "ETF",
			subtype: "ETF",
			balanceCents: 128760,
			quantity: "10",
			unitValue: "128.76",
			investedCents: null,
			profitCents: null,
		});
	});

	it("campos ausentes ou estranhos não derrubam a posição; linha sem id é descartada e contada", async () => {
		const weird = {
			id: "1a2b3c4d-0000-4aaa-8bbb-000000000199",
			name: 42,
			type: null,
			balance: "não é número",
			amount: "1e9",
			quantity: { x: 1 },
			date: 20261106,
			institution: "texto",
		};
		const fake = fakePluggy({
			investments: { [ITEM_ID]: [bareInvestment, weird, { name: "sem id" }, "lixo", null] },
		});
		const { investments, dropped } = await make(fake.fetch).investments(ITEM_ID);
		expect(dropped).toBe(3);
		const [bare, odd] = investments.map(toInvestmentPosition);
		expect(bare).toMatchObject({
			externalId: INV_BARE_ID,
			name: "Caixinha Reserva",
			type: "FIXED_INCOME",
			balanceCents: 25000,
			subtype: null,
			grossCents: null,
			investedCents: null,
			profitCents: null,
			quantity: null,
			rate: null,
			date: null,
			dueDate: null,
			status: null,
			currencyCode: null,
		});
		expect(odd).toMatchObject({
			name: null,
			type: null,
			balanceCents: null,
			grossCents: null,
			quantity: null,
			date: null,
			institutionName: null,
		});
	});

	it("guarda os campos que o schema não conhece (passthrough), para o diagnóstico listar os nomes", async () => {
		const fake = fakePluggy({ investments: { [ITEM_ID]: [{ ...cdbInvestment, campoNovo: "x" }] } });
		const { investments } = await make(fake.fetch).investments(ITEM_ID);
		expect(investments[0]).toMatchObject({ campoNovo: "x", owner: "FULANO DE TAL" });
	});

	it("pagina as posições", async () => {
		const many = Array.from({ length: 5 }, (_, n) => ({ ...bareInvestment, id: `inv-${n}` }));
		const fake = fakePluggy({ investments: { [ITEM_ID]: many }, pageSize: 2 });
		const { investments } = await make(fake.fetch).investments(ITEM_ID);
		expect(investments.map((i) => i.id)).toEqual(many.map((i) => i.id));
		expect(fake.requests.filter((r) => r.url.pathname === "/investments")).toHaveLength(3);
	});

	it("recusa itemId e id de investimento que não servem para URL", async () => {
		const client = make(fakePluggy().fetch);
		await expect(client.investments("../x")).rejects.toThrow(RangeError);
		await expect(client.investmentTransactions("a/b")).rejects.toThrow(RangeError);
		await expect(client.investmentTransactions("../transactions")).rejects.toThrow(RangeError);
	});

	it("movimentações: todas as páginas, valores em centavos e linha ruim descartada", async () => {
		const rows = [
			invTx("m1", { amount: 10000, date: "2026-05-10T00:00:00.000Z" }),
			invTx("m2", {
				type: "INTEREST",
				movementType: "DEBIT",
				description: "Juros",
				amount: 12.5,
				netAmount: 10.63,
				date: "2026-08-10T03:00:00.000Z",
				expenses: { incomeTax: 1.87 },
			}),
			invTx("m3", {
				type: "BUY",
				quantity: 1.25,
				value: 2.004,
				amount: 2.51,
				date: "2026-09-01T00:00:00.000Z",
			}),
			{ sem: "id" },
		];
		const fake = fakePluggy({ investmentTransactions: { [INV_CDB_ID]: rows }, pageSize: 2 });
		const { transactions, dropped } = await make(fake.fetch).investmentTransactions(INV_CDB_ID);
		expect(dropped).toBe(1);
		expect(transactions.map(toInvestmentMovement)).toEqual([
			expect.objectContaining({
				externalId: "m1",
				type: "BUY",
				movementType: "CREDIT",
				amountCents: 1000000,
			}),
			{
				externalId: "m2",
				type: "INTEREST",
				movementType: "DEBIT",
				date: "2026-08-10",
				tradeDate: "2026-05-10",
				description: "Juros",
				quantity: null,
				unitValue: null,
				amountCents: 1250,
				netAmountCents: 1063,
			},
			expect.objectContaining({ externalId: "m3", quantity: "1.25", unitValue: "2.004", amountCents: 251 }),
		]);
		const paths = fake.requests.filter((r) => r.url.pathname === `/investments/${INV_CDB_ID}/transactions`);
		expect(paths).toHaveLength(2);
	});
});

describe("readInvestments: nunca lança", () => {
	const refusing = (status: number) =>
		fakePluggy({
			override: (url) =>
				url.pathname.startsWith("/investments") ? json({ message: "segredo do corpo" }, status) : undefined,
		});

	it("lista vazia é ok com zero linhas", async () => {
		expect(await readInvestments(make(fakePluggy().fetch), ITEM_ID)).toEqual({
			outcome: "ok",
			rows: [],
			dropped: 0,
		});
	});

	it("403 e 404 do endpoint viram 'não disponível', sem lançar e sem corpo da resposta", async () => {
		for (const status of [403, 404]) {
			const client = make(refusing(status).fetch);
			await expect(client.investments(ITEM_ID)).rejects.toBeInstanceOf(PluggyError);
			const list = await readInvestments(client, ITEM_ID);
			expect(list).toEqual({
				outcome: "unavailable",
				code: status === 403 ? "forbidden" : "not_found",
				status,
				message: "O Pluggy não entrega investimentos para esta conexão.",
			});
			const txs = await readInvestmentTransactions(client, INV_CDB_ID);
			expect(txs).toMatchObject({ outcome: "unavailable", status });
			expect(JSON.stringify([list, txs])).not.toContain("segredo");
		}
	});

	it("5xx, limite de pedidos e formato inesperado viram 'erro' (para tentar depois), sem lançar", async () => {
		expect(await readInvestments(make(refusing(500).fetch), ITEM_ID)).toMatchObject({
			outcome: "error",
			code: "unavailable",
			status: 500,
		});
		expect(await readInvestments(make(refusing(429).fetch), ITEM_ID)).toMatchObject({
			outcome: "error",
			code: "rate_limit",
		});
		const broken = fakePluggy({
			override: (url) => (url.pathname === "/investments" ? json({ results: "x" }) : undefined),
		});
		expect(await readInvestments(make(broken.fetch), ITEM_ID)).toMatchObject({
			outcome: "error",
			code: "invalid_response",
		});
		const throwing = { investments: async () => Promise.reject(new Error("detalhe interno")) };
		expect(await readInvestments(throwing as never, ITEM_ID)).toEqual({
			outcome: "error",
			code: "unknown",
			status: null,
			message: "Falhou ao falar com o Pluggy.",
		});
	});
});

describe("conversão na borda", () => {
	it("centsOrNull: sem float no centavo; ausente e ilegível viram null, nunca zero", () => {
		expect(centsOrNull(10432.57)).toBe(1043257);
		expect(centsOrNull(0.1 + 0.2)).toBe(30);
		expect(centsOrNull("19.99")).toBe(1999);
		expect(centsOrNull(-244.5)).toBe(-24450);
		expect(centsOrNull(0)).toBe(0);
		expect(centsOrNull(null)).toBeNull();
		expect(centsOrNull(undefined)).toBeNull();
		expect(centsOrNull(Number.NaN)).toBeNull();
		expect(centsOrNull("abc")).toBeNull();
	});

	it("decimalText: texto canônico até 8 casas, sem notação científica", () => {
		expect(decimalText(3026.752341)).toBe("3026.752341");
		expect(decimalText(1.73482915)).toBe("1.73482915");
		expect(decimalText(100)).toBe("100");
		expect(decimalText(1.25)).toBe("1.25");
		expect(decimalText(0.1 + 0.2)).toBe("0.3");
		expect(decimalText(0.00000001)).toBe("0.00000001");
		expect(decimalText(1e-10)).toBe("0");
		expect(decimalText(-0)).toBe("0");
		expect(decimalText(-2.5)).toBe("-2.5");
		expect(decimalText("12.3400")).toBe("12.34");
		expect(decimalText("1e3")).toBeNull();
		expect(decimalText(Number.POSITIVE_INFINITY)).toBeNull();
		expect(decimalText(null)).toBeNull();
	});
});
