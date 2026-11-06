import { createDb, createPrismaStores, type Db } from "@orbita/db";
import { afterAll, describe, expect, it } from "vitest";
import { setupFinance } from "./test-support.ts";

// O mesmo app, agora sobre o Postgres de verdade (o CI sempre define DATABASE_URL_TEST).
const url = process.env.DATABASE_URL_TEST;
let db: Db | undefined;
afterAll(async () => db?.$disconnect());

async function clean(client: Db) {
	// Ordem das chaves estrangeiras: quem aponta vem antes de quem é apontado.
	await client.recurrencePosting.deleteMany();
	await client.transaction.deleteMany();
	await client.recurrence.deleteMany();
	await client.budget.deleteMany();
	await client.card.deleteMany();
	await client.account.deleteMany();
	await client.category.deleteMany();
	await client.device.deleteMany();
	await client.pairingCode.deleteMany();
}

describe.skipIf(!url)("API sobre Postgres", () => {
	async function setup() {
		db ??= createDb(url as string);
		await clean(db);
		const client = db;
		return setupFinance(undefined, (now) => createPrismaStores(client, { now }));
	}

	it("dá pra gastar com aluguel lançado e salário", async () => {
		const { api, basics } = await setup();
		const { account, category } = await basics();
		await api.put("/v1/budgets", { scope: "total", limitCents: 500000 });
		const rent = (
			await api.post("/v1/recurrences", {
				kind: "expense",
				name: "Aluguel",
				amountCents: 150000,
				dayOfMonth: 5,
				startDate: "2026-01-01",
				accountId: account.id,
			})
		).body.recurrence;
		const salary = (
			await api.post("/v1/recurrences", {
				kind: "income",
				name: "Salário",
				amountCents: 800000,
				dayOfMonth: 5,
				startDate: "2026-01-01",
				accountId: account.id,
			})
		).body.recurrence;
		await api.post("/v1/transactions", {
			kind: "expense",
			amountCents: 20000,
			date: "2026-11-08",
			description: "Mercado",
			accountId: account.id,
			categoryId: category("mercado"),
		});

		const before = (await api.get("/v1/summary/2026-11")).body;
		expect(before.pendingRecurring).toEqual({ expenseCents: 150000, incomeCents: 800000 });
		expect(before.safeToSpend.availableCents).toBe(330000);

		expect((await api.post(`/v1/recurrences/${rent.id}/post`, { month: "2026-11" })).status).toBe(201);
		expect((await api.post(`/v1/recurrences/${salary.id}/post`, { month: "2026-11" })).status).toBe(201);
		const after = (await api.get("/v1/summary/2026-11")).body;
		expect(after.pendingRecurring).toEqual({ expenseCents: 0, incomeCents: 0 });
		expect(after.summary).toMatchObject({ spentCents: 170000, incomeCents: 800000 });
		expect(after.safeToSpend).toEqual({ availableCents: 330000, perDayCents: 20625, remainingDays: 16 });
		expect(after.projection.projectedCents).toBe(190000);
	});

	it("lançamentos simultâneos da mesma recorrência: um só vence", async () => {
		const { api, basics } = await setup();
		const { account } = await basics();
		const rec = (
			await api.post("/v1/recurrences", {
				kind: "expense",
				name: "Aluguel",
				amountCents: 100,
				dayOfMonth: 5,
				startDate: "2026-01-01",
				accountId: account.id,
			})
		).body.recurrence;
		const results = await Promise.all(
			Array.from({ length: 6 }, () => api.post(`/v1/recurrences/${rec.id}/post`, { month: "2026-11" })),
		);
		expect(results.filter((r) => r.status === 201)).toHaveLength(1);
		expect(results.filter((r) => r.status === 409)).toHaveLength(5);
		expect((await api.get("/v1/transactions/month/2026-11")).body.transactions).toHaveLength(1);
	});

	it("parcelamentos vêm com as parcelas na ordem do número e a fatura mostra a sua", async () => {
		const { api, basics } = await setup();
		const { card } = await basics();
		for (const description of ["Geladeira", "Sofá"]) {
			await api.post("/v1/transactions/installments", {
				cardId: card.id,
				totalCents: 120000,
				count: 12,
				date: "2026-11-15",
				description,
			});
		}
		const { groups } = (await api.get("/v1/installments?from=2027-02")).body;
		expect(groups).toHaveLength(2);
		for (const g of groups) {
			expect(g.installments.map((t: { installmentNumber: number }) => t.installmentNumber)).toEqual([
				1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
			]);
			expect(g).toMatchObject({ paidCount: 2, remainingCount: 10, totalCents: 120000 });
		}

		const dec = (await api.get(`/v1/cards/${card.id}/invoices/2026-12`)).body;
		expect(dec.invoice).toMatchObject({ month: "2026-12", dueDate: "2026-12-20", status: "open" });
		expect(dec.composition).toEqual({
			purchasesCents: 0,
			installmentsCents: 20000,
			recurringCents: 0,
			refundsCents: 0,
			totalCents: 20000,
		});
		expect(dec.transactions).toHaveLength(2);
		expect((await api.get("/v1/summary/2026-11")).body.summary.spentCents).toBe(20000);
	});

	it("estorno de outro mês, pagamento de fatura e erro de referência", async () => {
		const { api, basics } = await setup();
		const { account, card, category } = await basics();
		const old = (
			await api.post("/v1/transactions", {
				kind: "expense",
				amountCents: 30000,
				date: "2026-10-20",
				description: "M",
				accountId: account.id,
				categoryId: category("mercado"),
			})
		).body.transaction;
		await api.post("/v1/transactions", {
			kind: "expense",
			amountCents: 20000,
			date: "2026-11-02",
			description: "M2",
			accountId: account.id,
			categoryId: category("mercado"),
		});
		await api.post("/v1/transactions", {
			kind: "refund",
			amountCents: 10000,
			date: "2026-11-10",
			description: "E",
			accountId: account.id,
			refundOfId: old.id,
		});
		await api.post("/v1/transactions", {
			kind: "card_payment",
			amountCents: 9000,
			date: "2026-11-12",
			description: "Fatura",
			cardId: card.id,
			accountId: account.id,
		});
		const s = (await api.get("/v1/summary/2026-11")).body;
		expect(s.summary.byCategory[category("mercado")]).toBe(10000);
		await api.delete(`/v1/accounts/${account.id}`);
		const res = await api.post("/v1/transactions", {
			kind: "expense",
			amountCents: 1,
			date: "2026-11-10",
			description: "x",
			accountId: account.id,
		});
		expect(res.status).toBe(422);
	});
});
