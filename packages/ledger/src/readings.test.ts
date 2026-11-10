import { invoiceFor } from "@orbita/core";
import { type CardRecord, createMemoryStores, type Stores, toCardConfig } from "@orbita/db";
import {
	accountBalancesResponse,
	cashFlowResponse,
	installmentStandingDto,
	invoiceHistoryPointDto,
	spendingDailyResponse,
} from "@orbita/shared";
import { describe, expect, it } from "vitest";
import { accountBalances } from "./balances.ts";
import { cashFlow } from "./cash-flow.ts";
import { invoicesOverview, monthState } from "./invoices-overview.ts";
import { spendingDaily } from "./spending-daily.ts";
import { activeInstallments, monthSummary } from "./summary.ts";

const NOW = new Date("2026-11-15T15:00:00Z");
const SYNCED = new Date("2026-11-15T14:00:00Z");

const newStores = () => createMemoryStores({ now: () => NOW });

/** Compra no cartão: a fatura é a que o engine acha pela data (a API faz o mesmo). */
const purchase = (stores: Stores, card: CardRecord, date: string, amountCents: number, description: string) =>
	stores.transactions.create({
		kind: "expense",
		amountCents,
		date,
		description,
		cardId: card.id,
		invoiceMonth: invoiceFor(date, toCardConfig(card)).month,
	});

describe("limite do cartão: o que o banco informa", () => {
	it("usado = limite − disponível; total e disponível de todos os cartões (números reais do dono)", async () => {
		const stores = newStores();
		const real: [string, number, number][] = [
			["Nubank", 577000, 523267],
			["Inter", 290000, 256144],
			["Itaú", 566000, 535100],
			["Santander", 700000, 613130],
		];
		for (const [name, limitCents, availableCents] of real) {
			const card = await stores.cards.create({ name, closingDay: 10, dueDay: 20, limitCents });
			await stores.cards.recordAvailable(card.id, availableCents, SYNCED);
		}
		const overview = await invoicesOverview(stores, "2026-11-15");
		expect(overview.cards.map((c) => c.limit.usedCents).sort((a, b) => a - b)).toEqual([
			30900, 33856, 53733, 86870,
		]);
		const byName = Object.fromEntries(overview.cards.map((c) => [c.card.name, c.limit]));
		expect(byName.Nubank).toMatchObject({ usedCents: 53733, availableCents: 523267, source: "bank" });
		expect(byName.Nubank?.syncedAt).toBe(SYNCED.toISOString());
		expect(overview.cards[0]?.usedLimitCents).toBe(overview.cards[0]?.limit.usedCents);
		expect(overview.limits).toEqual({
			limitCents: 2133000,
			usedCents: 205359,
			availableCents: 1927641,
			cardsCounted: 4,
			cardsWithoutLimit: 0,
			oldestSyncedAt: SYNCED.toISOString(),
		});
	});

	it("sem o disponível do banco cai na estimativa (o que se deve); sem limite não há disponível", async () => {
		const stores = newStores();
		const manual = await stores.cards.create({
			name: "Manual",
			closingDay: 10,
			dueDay: 20,
			limitCents: 100000,
		});
		await stores.cards.create({ name: "Sem limite", closingDay: 10, dueDay: 20 });
		await purchase(stores, manual, "2026-11-12", 25000, "Compra");
		const overview = await invoicesOverview(stores, "2026-11-15");
		const a = overview.cards.find((c) => c.card.name === "Manual");
		const b = overview.cards.find((c) => c.card.name === "Sem limite");
		expect(a?.limit).toEqual({
			limitCents: 100000,
			availableCents: 75000,
			usedCents: 25000,
			source: "estimated",
			syncedAt: null,
		});
		expect(b?.limit).toMatchObject({ limitCents: null, availableCents: null, source: "none" });
		expect(overview.limits).toMatchObject({
			limitCents: 100000,
			usedCents: 25000,
			availableCents: 75000,
			cardsCounted: 1,
			cardsWithoutLimit: 1,
			oldestSyncedAt: null,
		});
	});

	it("o gráfico segue além do mês aberto só até a última fatura que já tem valor", async () => {
		const stores = newStores();
		const card = await stores.cards.create({
			name: "Futuro",
			closingDay: 10,
			dueDay: 20,
			limitCents: 100000,
		});
		await purchase(stores, card, "2026-11-12", 1000, "Aberta");
		const none = await invoicesOverview(stores, "2026-11-15");
		expect(none.history).toHaveLength(6);
		expect(none.history.at(-1)?.month).toBe("2026-12");
		await purchase(stores, card, "2027-01-12", 7000, "Parcela futura");
		const overview = await invoicesOverview(stores, "2026-11-15");
		expect(overview.history.map((h) => h.month).slice(-3)).toEqual(["2026-12", "2027-01", "2027-02"]);
		expect(overview.history.at(-1)).toMatchObject({ month: "2027-02", totalCents: 7000, state: "open" });
		for (const h of overview.history) invoiceHistoryPointDto.parse(h);
	});

	it("situação do mês entre cartões: a mais urgente; paga só se todas pagas", () => {
		expect(monthState(["paid", "closed"])).toBe("closed");
		expect(monthState(["open", "overdue", "paid"])).toBe("overdue");
		expect(monthState(["paid", "open"])).toBe("open");
		expect(monthState(["paid", "paid"])).toBe("paid");
		expect(monthState([])).toBe("paid");
	});

	it("disponível maior que o limite não dá uso negativo", async () => {
		const stores = newStores();
		const card = await stores.cards.create({ name: "Flex", closingDay: 10, dueDay: 20, limitCents: 100000 });
		await stores.cards.recordAvailable(card.id, 120000, SYNCED);
		const overview = await invoicesOverview(stores, "2026-11-15");
		expect(overview.cards[0]?.limit.usedCents).toBe(0);
	});
});

describe("faturas: total e pagamento do banco", () => {
	async function seed() {
		const stores = newStores();
		const account = await stores.accounts.create({ name: "Conta", kind: "checking" });
		const card = await stores.cards.create({ name: "Cartão", closingDay: 10, dueDay: 20 });
		const bill = (
			externalId: string,
			dueDate: string,
			closeDate: string,
			totalAmountCents: number,
			payments = [] as never[],
		) =>
			stores.bills.upsert({
				cardId: card.id,
				source: "pluggy",
				externalId,
				dueDate,
				closeDate,
				totalAmountCents,
				payments,
				syncedAt: SYNCED,
			});
		return { stores, account, card, bill };
	}

	it("fechada usa o total do banco; o pagamento da N está em payments da N+1; a aberta é a soma dos lançamentos", async () => {
		const { stores, card, bill } = await seed();
		// Lançamentos do Órbita divergem do banco de propósito: o total do banco é o que vale na fechada.
		await purchase(stores, card, "2026-10-05", 1000, "X");
		await purchase(stores, card, "2026-11-20", 5150, "Aberta");
		await bill("b-out", "2026-10-20", "2026-10-10", 51000);
		await bill("b-nov", "2026-11-20", "2026-11-10", 72151, [
			{ externalId: "p1", date: "2026-10-22", amountCents: 51000 } as never,
		]);
		const overview = await invoicesOverview(stores, "2026-11-15");
		const line = overview.cards[0];
		expect(line?.due).toMatchObject({
			month: "2026-11",
			source: "bank",
			state: "closed",
			status: "closed",
			totalCents: 72151,
			paidCents: 0,
			owedCents: 72151,
			dueDate: "2026-11-20",
		});
		expect(line?.open).toMatchObject({ month: "2026-12", source: "ledger", state: "open", totalCents: 5150 });
		// "Total em faturas" = a devida + a aberta; a de outubro (paga pelos payments da de novembro) não entra.
		expect(overview.owedCents).toBe(72151 + 5150);
		const oct = overview.history.find((h) => h.month === "2026-10");
		expect(oct?.totalCents).toBe(51000);
		expect(overview.history).toHaveLength(6);
		expect(overview.history.at(-1)).toMatchObject({ month: "2026-12", totalCents: 5150, open: true });
		for (const h of overview.history) invoiceHistoryPointDto.parse(h);
	});

	it("paga: payments da N+1 do banco cobrem a N; card_payment casado também vale (a maior medida, sem somar)", async () => {
		const { stores, account, card, bill } = await seed();
		await bill("b-out", "2026-10-20", "2026-10-10", 51000);
		await bill("b-nov", "2026-11-20", "2026-11-10", 72151, [
			{ externalId: "p1", date: "2026-10-22", amountCents: 51000 } as never,
		]);
		await stores.transactions.create({
			kind: "card_payment",
			amountCents: 72151,
			date: "2026-11-14",
			description: "Fatura",
			accountId: account.id,
			cardId: card.id,
		});
		const overview = await invoicesOverview(stores, "2026-11-15");
		const line = overview.cards[0];
		expect(line?.due).toMatchObject({ month: "2026-11", state: "paid", paymentStatus: "paid", owedCents: 0 });
		expect(overview.owedCents).toBe(0);
	});

	it("vencida: fechada com vencimento do banco no passado e sem pagamento", async () => {
		const { stores, card, bill } = await seed();
		await bill("b-nov", "2026-11-20", "2026-11-10", 72151);
		await purchase(stores, card, "2026-11-12", 100, "X");
		const overview = await invoicesOverview(stores, "2026-11-25");
		expect(overview.cards[0]?.due).toMatchObject({ state: "overdue", status: "overdue", owedCents: 72151 });
		expect(overview.nextDueDate).toBe("2026-11-20");
	});

	it("sem fatura do banco (cartão manual) o cálculo atual continua", async () => {
		const { stores, card } = await seed();
		await purchase(stores, card, "2026-11-05", 8000, "X");
		const line = (await invoicesOverview(stores, "2026-11-15")).cards[0];
		expect(line?.due).toMatchObject({
			source: "ledger",
			state: "closed",
			totalCents: 8000,
			bankSyncedAt: null,
		});
	});
});

describe("saldo em contas", () => {
	it("total, parte de cada conta e conta sem saldo marcada", async () => {
		const stores = newStores();
		const mp = await stores.accounts.create({ name: "Mercado Pago", kind: "checking", bankCode: "323" });
		const inter = await stores.accounts.create({ name: "Inter", kind: "checking" });
		await stores.accounts.create({ name: "Carteira", kind: "wallet" });
		await stores.accounts.recordBalance(mp.id, 20535, SYNCED);
		await stores.accounts.recordBalance(inter.id, 60000, new Date("2026-11-14T10:00:00Z"));
		const res = accountBalancesResponse.parse(await accountBalances(stores));
		expect(res.totalCents).toBe(80535);
		expect(res.withoutBalanceCount).toBe(1);
		expect(res.accounts.map((a) => a.name)).toEqual(["Inter", "Mercado Pago", "Carteira"]);
		expect(res.accounts[1]).toMatchObject({ balanceCents: 20535, hasBalance: true, sharePercent: 25.5 });
		expect(res.accounts[2]).toMatchObject({
			balanceCents: null,
			hasBalance: false,
			sharePercent: null,
			syncedAt: null,
		});
		expect(res.oldestSyncedAt).toBe("2026-11-14T10:00:00.000Z");
	});

	it("saldo negativo entra no total e não tem parte", async () => {
		const stores = newStores();
		const a = await stores.accounts.create({ name: "A", kind: "checking" });
		const b = await stores.accounts.create({ name: "B", kind: "checking" });
		await stores.accounts.recordBalance(a.id, 10000, SYNCED);
		await stores.accounts.recordBalance(b.id, -2000, SYNCED);
		const res = await accountBalances(stores);
		expect(res.totalCents).toBe(8000);
		expect(res.accounts.find((x) => x.name === "B")?.sharePercent).toBeNull();
	});
});

describe("fluxo de caixa", () => {
	it("entradas e saídas das contas, com pagamento de fatura; sem transferência própria nem compra no cartão", async () => {
		const stores = newStores();
		const a = await stores.accounts.create({ name: "A", kind: "checking" });
		const b = await stores.accounts.create({ name: "B", kind: "checking" });
		const card = await stores.cards.create({ name: "Cartão", closingDay: 10, dueDay: 20 });
		const tx = (t: Record<string, unknown>) =>
			stores.transactions.create({ date: "2026-11-05", description: "x", accountId: a.id, ...t } as never);
		await tx({ kind: "income", amountCents: 500000 });
		await tx({ kind: "expense", amountCents: 30000 });
		await tx({ kind: "card_payment", amountCents: 80000, cardId: card.id });
		await tx({ kind: "investment", amountCents: 10000 });
		await tx({ kind: "redemption", amountCents: 2000 });
		await tx({ kind: "transfer", amountCents: 70000, counterpartAccountId: b.id });
		// Compra no cartão e lançamento de outro mês não são caixa deste mês.
		await purchase(stores, card, "2026-11-06", 99999, "c");
		await tx({ kind: "expense", amountCents: 12345, date: "2026-10-30" });
		const res = cashFlowResponse.parse(await cashFlow(stores, "2026-11"));
		expect(res).toMatchObject({
			inCents: 502000,
			outCents: 120000,
			netCents: 382000,
			in: { incomeCents: 500000, redemptionCents: 2000, refundCents: 0 },
			out: { expenseCents: 30000, cardPaymentCents: 80000, investedCents: 10000 },
			ignoredTransferCents: 70000,
		});
	});
});

describe("fluxo de caixa e saldo com conta arquivada por conexão removida", () => {
	it("os lançamentos dela seguem no caixa do mês e só o saldo sai", async () => {
		const stores = newStores();
		const gone = await stores.accounts.create({
			name: "Itaú",
			kind: "checking",
			source: "pluggy",
			externalId: "a1",
		});
		const owner = await stores.accounts.create({ name: "Manual", kind: "checking" });
		await stores.accounts.linkConnection(gone.id, "conn");
		await stores.accounts.recordBalance(gone.id, 10000, SYNCED);
		await stores.accounts.recordBalance(owner.id, 500, SYNCED);
		const tx = (accountId: string, amountCents: number) =>
			stores.transactions.create({
				date: "2026-11-05",
				description: "x",
				kind: "expense",
				accountId,
				amountCents,
			} as never);
		await tx(gone.id, 4000);
		await tx(owner.id, 1000);
		await stores.accounts.archiveByConnection("conn");
		const flow = await cashFlow(stores, "2026-11");
		expect(flow.out.expenseCents).toBe(5000);
		const balances = await accountBalances(stores);
		expect(balances.accounts.map((a) => a.name)).toEqual(["Manual"]);
		expect(balances.totalCents).toBe(500);
		// Conta arquivada pelo dono (não por conexão) segue fora do caixa, como antes.
		await stores.accounts.archive(owner.id);
		expect((await cashFlow(stores, "2026-11")).out.expenseCents).toBe(4000);
	});
});

describe("parcelas: pela parcela vista", () => {
	it("11 de 21 de R$ 86,87: 10 pagas (estimadas), 11 faltam, última em set/2027", async () => {
		const stores = newStores();
		const card = await stores.cards.create({ name: "Cartão", closingDay: 10, dueDay: 20 });
		await stores.transactions.upsertInstallmentByExternal(
			"pluggy",
			"g1-11",
			{
				kind: "expense",
				amountCents: 8687,
				description: "Kabum",
				cardId: card.id,
				date: "2026-11-02",
				invoiceMonth: "2026-11",
				budgetMonth: "2026-11",
			},
			{ groupId: "g1", number: 11, count: 21 },
		);
		const [group] = await activeInstallments(stores, "2026-11", "2026-11-15");
		const standing = installmentStandingDto.parse(group);
		expect(standing).toMatchObject({
			count: 21,
			currentNumber: 11,
			installmentCents: 8687,
			paidCount: 10,
			paidCents: 86870,
			paidEstimated: true,
			remainingCount: 11,
			remainingCents: 11 * 8687,
			committedMonthCents: 8687,
			lastInvoiceMonth: "2027-09",
		});
		expect(group?.description).toBe("Kabum");
	});
});

describe("gasto dia a dia", () => {
	async function seed() {
		const stores = newStores();
		await stores.categories.ensureDefaults();
		const account = await stores.accounts.create({ name: "Conta", kind: "checking" });
		const buy = (date: string, amountCents: number, description: string) =>
			stores.transactions.create({ kind: "expense", amountCents, date, description, accountId: account.id });
		return { stores, buy };
	}

	it("acumulado por dia fecha com o Gasto do Início; variação contra o mês anterior no mesmo dia; top 3", async () => {
		const { stores, buy } = await seed();
		await buy("2026-10-03", 10000, "Mercado Bom");
		await buy("2026-10-20", 50000, "Aluguel");
		await buy("2026-11-02", 6000, "IFOOD *RESTAURANTE 123");
		await buy("2026-11-05", 4000, "iFood");
		await buy("2026-11-10", 20000, "Posto Shell");
		await buy("2026-11-12", 3000, "Padaria Pão");
		await buy("2026-11-14", 500, "Cafe Central");
		const res = spendingDailyResponse.parse(await spendingDaily(stores, "2026-11", "2026-11-15"));
		const summary = await monthSummary(stores, "2026-11", "2026-11-15");
		expect(res.spentCents).toBe(summary.summary.spentCents);
		expect(res.spentCents).toBe(33500);
		expect(res.throughDay).toBe(15);
		expect(res.daysInMonth).toBe(30);
		expect(res.current).toHaveLength(15);
		expect(res.current[0]).toEqual({ day: 1, cumulativeCents: 0 });
		expect(res.current[1]).toEqual({ day: 2, cumulativeCents: 6000 });
		expect(res.current.at(-1)).toEqual({ day: 15, cumulativeCents: 33500 });
		expect(res.previous).toHaveLength(31);
		expect(res.previous.at(-1)?.cumulativeCents).toBe(60000);
		// O mês anterior tinha 10.000 até o dia 15.
		expect(res.previousSameDayCents).toBe(10000);
		expect(res.variancePercent).toBe(235);
		expect(res.topMerchants).toEqual([
			{ name: "Posto Shell", totalCents: 20000, count: 1 },
			{ name: expect.stringMatching(/ifood/i), totalCents: 10000, count: 2 },
			{ name: "Padaria Pão", totalCents: 3000, count: 1 },
		]);
	});

	it("mês anterior sem gasto: sem variação; mês fechado vai até o último dia", async () => {
		const { stores, buy } = await seed();
		await buy("2026-11-02", 6000, "Mercado");
		const now = await spendingDaily(stores, "2026-11", "2026-11-15");
		expect(now.variancePercent).toBeNull();
		const closed = await spendingDaily(stores, "2026-11", "2026-12-20");
		expect(closed.throughDay).toBe(30);
		expect(closed.current.at(-1)?.cumulativeCents).toBe(6000);
	});
});
