import { describe, expect, it } from "vitest";
import { createPluggyClient } from "./client.ts";
import { DIAGNOSTIC_INVESTMENTS_MAX, diagnoseConnection } from "./diagnostics.ts";
import {
	bankAccount,
	bareInvestment,
	CLIENT_ID,
	CLIENT_SECRET,
	cardAccount,
	cdbInvestment,
	type FakePluggyOptions,
	fakePluggy,
	fundInvestment,
	INV_CDB_ID,
	INV_FUND_ID,
	INV_STOCK_ID,
	ITEM_ID,
	invTx,
	stockInvestment,
} from "./fake-pluggy.ts";

// Dados fictícios (fake-pluggy.ts). Nada aqui grava: o diagnóstico só lê.

const NOW = new Date("2026-11-07T12:00:00.000Z");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

async function diagnose(options: FakePluggyOptions) {
	const fake = fakePluggy({ accounts: [], ...options });
	const client = createPluggyClient({ fetch: fake.fetch, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
	const out = await diagnoseConnection(
		{ client, now: () => NOW, linkOf: async () => null },
		{ id: ITEM_ID, label: "Corretora" },
	);
	return { out, fake };
}

describe("diagnóstico: investimentos da conexão", () => {
	it("mostra as posições com os campos brutos, as movimentações e o intervalo de datas", async () => {
		const { out } = await diagnose({
			item: {
				products: ["ACCOUNTS", "INVESTMENTS", "INVESTMENTS_TRANSACTIONS"],
				consentExpiresAt: "2027-06-01T00:00:00.000Z",
			},
			investments: { [ITEM_ID]: [cdbInvestment, fundInvestment, stockInvestment] },
			investmentTransactions: {
				[INV_CDB_ID]: [
					invTx("m1", { amount: 10000, date: "2026-05-10T00:00:00.000Z" }),
					invTx("m2", {
						type: "INTEREST",
						movementType: "DEBIT",
						amount: 12.5,
						date: "2026-08-10T00:00:00.000Z",
					}),
				],
				[INV_STOCK_ID]: [
					invTx("m3", { quantity: 100, value: 29.005, amount: 2900.5, date: "2025-12-01T00:00:00.000Z" }),
				],
			},
		});
		const inv = out.investments;
		expect(inv).toMatchObject({
			outcome: "ok",
			error: null,
			count: 3,
			dropped: 0,
			// 10.432,57 + 5.210,33 + 3.145,00, somados em centavos.
			balanceTotal: "R$ 18.787,90",
			productRequested: true,
			transactionsProductRequested: true,
			consentExpired: false,
			warnings: [],
			transactionsCount: 3,
			transactionsFirstDate: "2025-12-01",
			transactionsLastDate: "2026-08-10",
		});
		const [cdb, fund, stock] = inv?.positions ?? [];
		expect(cdb).toMatchObject({
			idStart: INV_CDB_ID.slice(0, 8),
			type: "FIXED_INCOME",
			subtype: "CDB",
			name: "CDB Banco Fictício 110% CDI",
			balance: 10432.57,
			amount: 10580.1,
			amountOriginal: 10000,
			amountProfit: 432.57,
			quantity: null,
			rate: 110,
			rateType: "CDI",
			dueDate: "2028-05-10",
			date: "2026-11-06",
			status: "ACTIVE",
			otherFields: ["number", "owner"],
		});
		expect(cdb?.transactions).toMatchObject({
			outcome: "ok",
			count: 2,
			firstDate: "2026-05-10",
			lastDate: "2026-08-10",
			byType: [
				{ type: "BUY", count: 1 },
				{ type: "INTEREST", count: 1 },
			],
		});
		expect(cdb?.transactions?.recent[0]).toMatchObject({
			date: "2026-08-10",
			type: "INTEREST",
			amount: 12.5,
		});
		expect(fund).toMatchObject({
			idStart: INV_FUND_ID.slice(0, 8),
			type: "MUTUAL_FUND",
			quantity: 3026.752341,
			value: 1.73482915,
			amountProfit: null,
			lastMonthRate: 0.87,
			// CNPJ do fundo: sequência longa de dígitos sai mascarada, como todo texto do diagnóstico.
			code: "•••181",
		});
		expect(fund?.transactions).toMatchObject({ outcome: "ok", count: 0, firstDate: null, lastDate: null });
		expect(stock).toMatchObject({
			type: "EQUITY",
			subtype: "STOCK",
			quantity: 100,
			value: 31.45,
			isin: "BREXEMACNOR1",
		});
	});

	it("nunca mostra titular, número da aplicação nem o id inteiro", async () => {
		const { out } = await diagnose({
			investments: {
				[ITEM_ID]: [
					{ ...cdbInvestment, owner: "FULANO DE TAL", number: "000123-4", taxNumber: "123.456.789-00" },
				],
			},
			investmentTransactions: {
				[INV_CDB_ID]: [invTx("m1", { description: "Aplicação CPF 123.456.789-00" })],
			},
		});
		const raw = JSON.stringify(out);
		for (const secret of ["FULANO", "000123-4", "123.456.789-00", "12345678900", INV_CDB_ID, ITEM_ID]) {
			expect(raw, secret).not.toContain(secret);
		}
		expect(out.investments?.positions[0]?.transactions?.recent[0]?.description).toBe("Aplicação CPF •••900");
		// Só os NOMES dos campos extras aparecem.
		expect(out.investments?.positions[0]?.otherFields).toEqual(["number", "owner", "taxNumber"]);
	});

	it("endpoint vazio: respondeu, zero posições, com o que o item diz", async () => {
		const { out, fake } = await diagnose({
			item: {
				products: ["ACCOUNTS", "TRANSACTIONS"],
				consentExpiresAt: "2026-01-01T00:00:00.000Z",
				statusDetail: {
					investments: { isUpdated: false, warnings: [{ code: "001", message: "sem permissão" }] },
				},
			},
		});
		expect(out.investments).toMatchObject({
			outcome: "empty",
			error: null,
			count: 0,
			positions: [],
			productRequested: false,
			transactionsProductRequested: false,
			consentExpired: true,
			warnings: ["investments 001: sem permissão"],
			balanceTotal: null,
		});
		// Sem posição, nenhuma consulta de movimentações.
		expect(fake.requests.some((r) => /\/investments\/.+\/transactions/.test(r.url.pathname))).toBe(false);
	});

	it("item sem lista de produtos nem validade: os sinais ficam null (não se inventa motivo)", async () => {
		const { out } = await diagnose({});
		expect(out.investments).toMatchObject({
			outcome: "empty",
			productRequested: null,
			transactionsProductRequested: null,
			consentExpired: null,
		});
	});

	it("403 do endpoint: produto não disponível, e as contas seguem normais", async () => {
		const { out } = await diagnose({
			accounts: [bankAccount, cardAccount],
			transactions: {},
			override: (url) =>
				url.pathname === "/investments" ? json({ message: "corpo secreto" }, 403) : undefined,
		});
		expect(out.error).toBeNull();
		expect(out.accounts).toHaveLength(2);
		expect(out.investments).toMatchObject({
			outcome: "unavailable",
			error: { code: "forbidden", status: 403 },
			count: 0,
			positions: [],
		});
		expect(JSON.stringify(out)).not.toContain("corpo secreto");
	});

	it("erro do endpoint (5xx) vira erro só da seção", async () => {
		const { out } = await diagnose({
			override: (url) => (url.pathname === "/investments" ? json({}, 503) : undefined),
		});
		expect(out.error).toBeNull();
		expect(out.investments).toMatchObject({ outcome: "error", error: { code: "unavailable", status: 503 } });
	});

	it("falha nas movimentações de uma posição fica só nela", async () => {
		const { out } = await diagnose({
			investments: { [ITEM_ID]: [cdbInvestment, stockInvestment] },
			investmentTransactions: { [INV_STOCK_ID]: [invTx("m3")] },
			override: (url) =>
				url.pathname === `/investments/${INV_CDB_ID}/transactions` ? json({ message: "x" }, 403) : undefined,
		});
		const [cdb, stock] = out.investments?.positions ?? [];
		expect(out.investments?.outcome).toBe("ok");
		expect(cdb?.transactions).toMatchObject({ outcome: "unavailable", error: { status: 403 }, count: 0 });
		expect(stock?.transactions).toMatchObject({ outcome: "ok", count: 1 });
		expect(out.investments?.transactionsCount).toBe(1);
	});

	it("falha ao ler as contas não esconde os investimentos", async () => {
		const { out } = await diagnose({
			investments: { [ITEM_ID]: [bareInvestment] },
			override: (url) => (url.pathname === "/accounts" ? json({}, 500) : undefined),
		});
		expect(out.error).toMatchObject({ code: "unavailable" });
		expect(out.investments).toMatchObject({ outcome: "ok", count: 1, balanceTotal: "R$ 250,00" });
		expect(out.investments?.positions[0]).toMatchObject({
			name: "Caixinha Reserva",
			subtype: null,
			date: null,
		});
	});

	it("falha ao ler o item: seção não consultada", async () => {
		const { out } = await diagnose({
			override: (url) => (url.pathname === `/items/${ITEM_ID}` ? json({}, 404) : undefined),
		});
		expect(out.error).toMatchObject({ code: "not_found" });
		expect(out.investments).toBeNull();
	});

	it("muitas posições: conta todas, detalha só até o teto", async () => {
		const many = Array.from({ length: DIAGNOSTIC_INVESTMENTS_MAX + 3 }, (_, n) => ({
			...bareInvestment,
			id: `inv-${n}`,
		}));
		const { out, fake } = await diagnose({ investments: { [ITEM_ID]: many } });
		expect(out.investments?.count).toBe(DIAGNOSTIC_INVESTMENTS_MAX + 3);
		expect(out.investments?.positions).toHaveLength(DIAGNOSTIC_INVESTMENTS_MAX);
		expect(fake.requests.filter((r) => /\/investments\/.+\/transactions/.test(r.url.pathname))).toHaveLength(
			DIAGNOSTIC_INVESTMENTS_MAX,
		);
	});
});
