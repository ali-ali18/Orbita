import { describe, expect, it } from "vitest";
import { setupFinance } from "../../test-support.ts";

/** Lançamento importado do Pluggy, como o sync grava (direto no store). */
async function seedImported(
	stores: Awaited<ReturnType<typeof setupFinance>>["stores"],
	accountId: string,
	externalId: string,
	description: string,
	extra: Record<string, unknown> = {},
) {
	const outros = await stores.categories.getBySlug("outros");
	const res = await stores.transactions.upsertByExternal("pluggy", externalId, {
		kind: "expense",
		amountCents: 1500,
		date: "2026-11-05",
		description,
		accountId,
		categoryId: outros?.id ?? null,
		sourceCategory: "Transfer - PIX",
		...extra,
	});
	return res.transaction?.id ?? "";
}

describe("regras de categoria", () => {
	it("expõe a categoria do banco e a marca de edição no lançamento", async () => {
		const { api, stores, basics } = await setupFinance();
		const { account } = await basics();
		const id = await seedImported(stores, account.id, "x1", "Pix enviado - Rei Dos Lanches 12/11", {
			merchantName: "Rei dos Lanches",
		});
		const body = (await api.get(`/v1/transactions/${id}`)).body.transaction;
		expect(body).toMatchObject({
			sourceCategory: "Transfer - PIX",
			merchantName: "Rei dos Lanches",
			categoryEditedByOwner: false,
		});
		const list = (await api.get("/v1/transactions")).body.transactions[0];
		expect(list.sourceCategory).toBe("Transfer - PIX");
	});

	it("PATCH de categoria marca categoryEditedByOwner; outros campos não", async () => {
		const { api, stores, basics } = await setupFinance();
		const { account, category } = await basics();
		const id = await seedImported(stores, account.id, "x2", "Padaria");
		expect(
			(await api.patch(`/v1/transactions/${id}`, { note: "oi" })).body.transaction.categoryEditedByOwner,
		).toBe(false);
		const same = await api.patch(`/v1/transactions/${id}`, {
			categoryId: (await stores.transactions.get(id))?.categoryId,
		});
		expect(same.body.transaction.categoryEditedByOwner).toBe(false);
		const changed = await api.patch(`/v1/transactions/${id}`, { categoryId: category("delivery") });
		expect(changed.body.transaction).toMatchObject({
			categoryId: category("delivery"),
			categoryEditedByOwner: true,
			sourceCategory: "Transfer - PIX",
		});
	});

	it("o corpo do PATCH não aceita mexer em sourceCategory nem na marca", async () => {
		const { api, stores, basics } = await setupFinance();
		const { account } = await basics();
		const id = await seedImported(stores, account.id, "x3", "Padaria");
		expect((await api.patch(`/v1/transactions/${id}`, { sourceCategory: "X" })).status).toBe(400);
		expect((await api.patch(`/v1/transactions/${id}`, { categoryEditedByOwner: true })).status).toBe(400);
	});

	it("POST deriva o padrão da descrição, corrige o lançamento de origem e lista/apaga a regra", async () => {
		const { api, stores, basics } = await setupFinance();
		const { account, category } = await basics();
		const id = await seedImported(stores, account.id, "r1", "Pix enviado - Rei Dos Lanches 12/11");
		const created = await api.post("/v1/category-rules", {
			transactionId: id,
			categoryId: category("delivery"),
		});
		expect(created.status).toBe(201);
		expect(created.body.rule).toMatchObject({ pattern: "rei dos lanches", categoryId: category("delivery") });
		expect(created.body.updated).toBe(0);
		expect(await stores.transactions.get(id)).toMatchObject({
			categoryId: category("delivery"),
			categoryEditedByOwner: true,
		});

		expect((await api.get("/v1/category-rules")).body.rules).toHaveLength(1);
		const del = await api.delete(`/v1/category-rules/${created.body.rule.id}`);
		expect(del.body).toEqual({ deleted: true });
		expect((await api.get("/v1/category-rules")).body.rules).toEqual([]);
		expect((await api.delete(`/v1/category-rules/${created.body.rule.id}`)).status).toBe(404);
	});

	it("o nome do estabelecimento do banco vale mais que a descrição", async () => {
		const { api, stores, basics } = await setupFinance();
		const { account, category } = await basics();
		const id = await seedImported(stores, account.id, "r2", "COMPRA 99887", {
			merchantName: "Padaria Central",
		});
		const created = await api.post("/v1/category-rules", {
			transactionId: id,
			categoryId: category("mercado"),
		});
		expect(created.body.rule.pattern).toBe("padaria central");
	});

	it("applyToExisting reclassifica só quem casa, é consumo e não foi editado à mão; devolve quantos", async () => {
		const { api, stores, basics } = await setupFinance();
		const { account, category } = await basics();
		const outros = await stores.categories.getBySlug("outros");
		const source = await seedImported(stores, account.id, "e0", "Pix enviado - Rei Dos Lanches 12/11");
		const same = await seedImported(stores, account.id, "e1", "Pix enviado - Rei dos Lanches 20/10");
		const merchantOnly = await seedImported(stores, account.id, "e2", "COMPRA 111", {
			merchantName: "REI DOS LANCHES LTDA",
		});
		const other = await seedImported(stores, account.id, "e3", "Pix enviado - Outro Lugar");
		const edited = await seedImported(stores, account.id, "e4", "Pix enviado - Rei Dos Lanches 01/10");
		await api.patch(`/v1/transactions/${edited}`, { categoryId: category("lazer") });
		const income = await stores.transactions.upsertByExternal("pluggy", "e5", {
			kind: "income",
			amountCents: 9000,
			date: "2026-11-01",
			description: "Pix recebido - Rei Dos Lanches",
			accountId: account.id,
		});

		const res = await api.post("/v1/category-rules", {
			transactionId: source,
			categoryId: category("delivery"),
			applyToExisting: true,
		});
		expect(res.status).toBe(201);
		expect(res.body.updated).toBe(2);
		const cat = async (id: string) => (await stores.transactions.get(id))?.categoryId;
		expect(await cat(same)).toBe(category("delivery"));
		expect(await cat(merchantOnly)).toBe(category("delivery"));
		expect(await cat(other)).toBe(outros?.id);
		expect(await cat(edited)).toBe(category("lazer"));
		expect(await cat(income.transaction?.id ?? "")).toBeNull();
		// A reclassificação por regra não conta como edição do dono.
		expect((await stores.transactions.get(same))?.categoryEditedByOwner).toBe(false);

		// Sem applyToExisting nada além do lançamento de origem muda.
		const second = await api.post("/v1/category-rules", {
			transactionId: other,
			categoryId: category("mercado"),
		});
		expect(second.body.updated).toBe(0);
	});

	it("regra mais específica não é atropelada por outra mais geral", async () => {
		const { api, stores, basics } = await setupFinance();
		const { account, category } = await basics();
		const eats = await seedImported(stores, account.id, "s1", "Uber Eats Pedido");
		await api.post("/v1/category-rules", { transactionId: eats, categoryId: category("delivery") });
		const trip = await seedImported(stores, account.id, "s2", "Uber Trip");
		const res = await api.post("/v1/category-rules", {
			transactionId: trip,
			categoryId: category("transporte"),
			applyToExisting: true,
		});
		expect(res.body.rule.pattern).toBe("uber trip");
		expect((await stores.transactions.get(eats))?.categoryId).toBe(category("delivery"));
	});

	it("erros: lançamento inexistente 404, sem nome de estabelecimento 400, categoria inexistente 422, corpo extra 400", async () => {
		const { api, stores, basics } = await setupFinance();
		const { account, category } = await basics();
		expect(
			(
				await api.post("/v1/category-rules", {
					transactionId: "nao-existe",
					categoryId: category("delivery"),
				})
			).status,
		).toBe(404);
		const bare = await seedImported(stores, account.id, "z1", "Pix enviado");
		const noName = await api.post("/v1/category-rules", {
			transactionId: bare,
			categoryId: category("delivery"),
		});
		expect(noName.status).toBe(400);
		expect(noName.body.error.message).toContain("estabelecimento");
		const real = await seedImported(stores, account.id, "z2", "Padaria Boa");
		expect(
			(await api.post("/v1/category-rules", { transactionId: real, categoryId: "nao-existe" })).status,
		).toBe(422);
		// Falhou antes de mexer no lançamento.
		expect((await stores.transactions.get(real))?.categoryEditedByOwner).toBe(false);
		expect(
			(await api.post("/v1/category-rules", { transactionId: real, categoryId: category("delivery"), x: 1 }))
				.status,
		).toBe(400);
		expect((await api.post("/v1/category-rules", {})).status).toBe(400);
	});
});

describe("parcelamento importado (grupo parcial)", () => {
	it("mostra 'n de N' e conta as parcelas que ainda não vieram como o que falta", async () => {
		const { api, stores, basics } = await setupFinance("2026-11-12T12:00:00Z");
		const { card } = await basics();
		const put = (n: number, invoiceMonth: string) =>
			stores.transactions.upsertInstallmentByExternal(
				"pluggy",
				`p${n}`,
				{
					kind: "expense",
					amountCents: 25_000,
					date: "2026-09-05",
					description: "Geladeira",
					cardId: card.id,
					invoiceMonth,
					budgetMonth: `2026-${String(8 + n).padStart(2, "0")}`,
				},
				{ groupId: "pluggy-g", number: n, count: 6 },
			);
		await put(2, "2026-10");
		await put(3, "2026-11");
		const group = (await api.get("/v1/installments")).body.groups[0];
		expect(group).toMatchObject({
			count: 6,
			currentNumber: 3,
			// A 1 nunca foi vista: estimada pelo valor da primeira vista (a 2); a 2 já foi paga.
			paidCount: 2,
			paidCents: 50_000,
			paidEstimated: true,
			// A parcela 3 (fatura atual) + 3 que ainda não vieram (4, 5, 6).
			remainingCount: 4,
			remainingCents: 100_000,
			remainingEstimated: true,
			totalCents: 150_000,
		});
		expect(group.installments.map((i: { installmentNumber: number }) => i.installmentNumber)).toEqual([2, 3]);
		// O gasto do mês é só a parcela do mês.
		expect((await api.get("/v1/summary/2026-11")).body.summary.spentCents).toBe(25_000);
	});
});
