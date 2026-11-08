import { describe, expect, it } from "vitest";
import { setupFinance } from "../../test-support.ts";

// Só a memória aqui; o contrato da store cobre Prisma e memória (`transaction-store.contract.test.ts`).
async function seed() {
	const ctx = await setupFinance();
	const { account, card, category } = await ctx.basics();
	const make = async (extra: Record<string, unknown> = {}) => {
		const res = await ctx.api.post("/v1/transactions", {
			kind: "expense",
			amountCents: 4690,
			date: "2026-11-06",
			description: "iFood",
			accountId: account.id,
			...extra,
		});
		expect(res.status).toBe(201);
		return res.body.transaction as { id: string };
	};
	return { ...ctx, account, card, category, make };
}

describe("POST /v1/transactions/:id/split", () => {
	it("divide em partes com categorias diferentes e a soma fecha em centavos", async () => {
		const { api, make, category } = await seed();
		const original = await make();
		const res = await api.post(`/v1/transactions/${original.id}/split`, {
			parts: [
				{ amountCents: 3000, categoryId: category("mercado") },
				{ amountCents: 1690, categoryId: category("delivery"), description: "Sobremesa" },
			],
		});
		expect(res.status).toBe(201);
		const parts = res.body.transactions as Array<{
			amountCents: number;
			description: string;
			splitGroupId: string;
			categoryId: string;
		}>;
		expect(parts.map((p) => p.amountCents)).toEqual([3000, 1690]);
		expect(parts.reduce((s, p) => s + p.amountCents, 0)).toBe(4690);
		expect(parts.map((p) => p.description)).toEqual(["iFood", "Sobremesa"]);
		expect(parts[0]?.splitGroupId).toBe(parts[1]?.splitGroupId);
		expect(parts[0]?.splitGroupId).toBeTruthy();

		expect((await api.get(`/v1/transactions/${original.id}`)).status).toBe(404);
		const list = await api.get("/v1/transactions?limit=10");
		expect(list.body.transactions).toHaveLength(2);
	});

	it("soma que não fecha dá 400 em pt-BR e não muda nada", async () => {
		const { api, make } = await seed();
		const original = await make();
		const res = await api.post(`/v1/transactions/${original.id}/split`, {
			parts: [{ amountCents: 3000 }, { amountCents: 1000 }],
		});
		expect(res.status).toBe(400);
		expect(res.body.error.message).toBe("As partes precisam somar exatamente o valor do lançamento.");
		expect((await api.get(`/v1/transactions/${original.id}`)).status).toBe(200);
		expect((await api.get("/v1/transactions?limit=10")).body.transactions).toHaveLength(1);
	});

	it("corpo inválido (uma parte só, valor fracionado) é recusado na borda", async () => {
		const { api, make } = await seed();
		const original = await make();
		const one = await api.post(`/v1/transactions/${original.id}/split`, { parts: [{ amountCents: 4690 }] });
		expect(one.status).toBe(400);
		const fraction = await api.post(`/v1/transactions/${original.id}/split`, {
			parts: [{ amountCents: 46.9 }, { amountCents: 4643.1 }],
		});
		expect(fraction.status).toBe(400);
	});

	it("parcela não divide e id que não existe dá 404", async () => {
		const { api, card } = await seed();
		const created = await api.post("/v1/transactions/installments", {
			cardId: card.id,
			totalCents: 10000,
			count: 2,
			date: "2026-11-06",
			description: "TV",
		});
		const installmentId = created.body.transactions[0].id as string;
		const res = await api.post(`/v1/transactions/${installmentId}/split`, {
			parts: [{ amountCents: 2500 }, { amountCents: 2500 }],
		});
		expect(res.status).toBe(400);
		const missing = await api.post("/v1/transactions/nao-existe/split", {
			parts: [{ amountCents: 1 }, { amountCents: 1 }],
		});
		expect(missing.status).toBe(404);
	});

	it("exige aparelho pareado", async () => {
		const { call } = await seed();
		const res = await call("POST", "/v1/transactions/x/split", { parts: [] }, null);
		expect(res.status).toBe(401);
	});
});
