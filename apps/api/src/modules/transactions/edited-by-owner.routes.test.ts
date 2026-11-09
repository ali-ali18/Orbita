import { describe, expect, it } from "vitest";
import { setupFinance } from "../../test-support.ts";

// Só a memória aqui; o contrato da store cobre Prisma e memória (`transaction-store.contract.test.ts`).
async function seed() {
	const ctx = await setupFinance();
	const { account, card, category } = await ctx.basics();
	const second = (await ctx.api.post("/v1/accounts", { name: "Outra conta", kind: "checking" })).body.account;
	/** Como o sync grava: pela origem Pluggy, direto no store. */
	const imported = async (extra: Record<string, unknown> = {}) => {
		const res = await ctx.stores.transactions.upsertByExternal("pluggy", `x-${Math.random()}`, {
			kind: "expense",
			amountCents: 4590,
			date: "2026-11-05",
			description: "Pix enviado - Fulano",
			accountId: account.id,
			...extra,
		});
		return res.transaction?.id ?? "";
	};
	const flag = async (id: string) => (await ctx.api.get(`/v1/transactions/${id}`)).body.transaction;
	return { ...ctx, account, second, card, category, imported, flag };
}

describe("PATCH liga a marca geral editedByOwner (o sync não reescreve mais o lançamento)", () => {
	it("nasce desligada e nota, descrição e categoria não ligam a geral", async () => {
		const { api, imported, flag, category } = await seed();
		const id = await imported();
		expect(await flag(id)).toMatchObject({ editedByOwner: false, categoryEditedByOwner: false });
		await api.patch(`/v1/transactions/${id}`, { note: "oi", description: "Pix para o Zé" });
		await api.patch(`/v1/transactions/${id}`, { categoryId: category("mercado") });
		expect(await flag(id)).toMatchObject({ editedByOwner: false, categoryEditedByOwner: true });
	});

	it.each([
		["tipo", { kind: "income" }],
		["data", { date: "2026-11-04" }],
		["valor", { amountCents: 5000 }],
		["conta", { accountId: "SECOND" }],
	])("mudar %s liga a marca", async (_name, patch) => {
		const { api, imported, flag, second } = await seed();
		const id = await imported();
		const body = JSON.parse(JSON.stringify(patch).replace("SECOND", second.id));
		const res = await api.patch(`/v1/transactions/${id}`, body);
		expect(res.status).toBe(200);
		expect(await flag(id)).toMatchObject({ editedByOwner: true });
	});

	it("o cartão trocado liga a marca; repetir o valor que já estava não liga", async () => {
		const { api, imported, flag, card } = await seed();
		const same = await imported();
		await api.patch(`/v1/transactions/${same}`, { kind: "expense", amountCents: 4590, date: "2026-11-05" });
		expect(await flag(same)).toMatchObject({ editedByOwner: false });

		const id = await imported();
		const res = await api.patch(`/v1/transactions/${id}`, { accountId: null, cardId: card.id });
		expect(res.status).toBe(200);
		expect(await flag(id)).toMatchObject({ editedByOwner: true, cardId: card.id });
	});

	it("confirmar um pendente liga a marca; o corpo do PATCH não aceita a marca nem desligá-la", async () => {
		const { api, imported, flag } = await seed();
		const id = await imported({ status: "pending", note: "Pagamento de fatura: revise." });
		expect(await flag(id)).toMatchObject({ status: "pending", editedByOwner: false });
		const confirmed = await api.post(`/v1/transactions/${id}/confirm`);
		expect(confirmed.body.transaction).toMatchObject({ status: "confirmed", editedByOwner: true });
		// Já confirmado: o segundo toque não muda nada.
		expect((await api.post(`/v1/transactions/${id}/confirm`)).body.transaction.editedByOwner).toBe(true);
		expect((await api.patch(`/v1/transactions/${id}`, { editedByOwner: false })).status).toBe(400);
	});
});
