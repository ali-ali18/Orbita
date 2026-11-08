import { describe, expect, it } from "vitest";
import { setupFinance } from "../../test-support.ts";

// Só a memória aqui; o Postgres tem o mesmo cenário em `postgres.api.test.ts` e o contrato da store cobre o resto.
async function seed() {
	const ctx = await setupFinance();
	const { account, card, category } = await ctx.basics();
	const make = async (extra: Record<string, unknown>) => {
		const res = await ctx.api.post("/v1/transactions", {
			kind: "expense",
			amountCents: 1000,
			date: "2026-11-10",
			description: "Item",
			accountId: account.id,
			...extra,
		});
		expect(res.status).toBe(201);
		return res.body.transaction.id as string;
	};
	const list = async (query: string) => {
		const res = await ctx.api.get(`/v1/transactions?${query}`);
		return { ...res, ids: (res.body.transactions ?? []).map((t: { id: string }) => t.id) as string[] };
	};
	return { ...ctx, account, card, category, make, list };
}

describe("GET /v1/transactions com filtros", () => {
	it("filtra por tipo, período e valor, em centavos", async () => {
		const { make, list } = await seed();
		const small = await make({ amountCents: 500, date: "2026-10-01" });
		const mid = await make({ amountCents: 5000, date: "2026-11-05" });
		const income = await make({ kind: "income", amountCents: 9000, date: "2026-11-06" });
		expect((await list("kinds=income")).ids).toEqual([income]);
		expect((await list("kinds=expense,income&from=2026-11-01&to=2026-11-30")).ids).toEqual([income, mid]);
		expect((await list("minCents=1000&maxCents=5000")).ids).toEqual([mid]);
		expect((await list("maxCents=500")).ids).toEqual([small]);
	});

	it("filtra por conta, cartão (OU) e categoria", async () => {
		const { make, list, account, card, category } = await seed();
		const onAccount = await make({ categoryId: category("mercado") });
		const onCard = await make({ accountId: null, cardId: card.id, date: "2026-11-11" });
		expect((await list(`accountIds=${account.id}`)).ids).toEqual([onAccount]);
		expect((await list(`cardIds=${card.id}`)).ids).toEqual([onCard]);
		expect((await list(`accountIds=${account.id}&cardIds=${card.id}`)).ids).toEqual([onCard, onAccount]);
		expect((await list(`categoryIds=${category("mercado")}`)).ids).toEqual([onAccount]);
	});

	it("filtra por origem e situação", async () => {
		const { make, list, stores } = await seed();
		const manual = await make({});
		const pending = await make({ date: "2026-11-11" });
		await stores.transactions.update(pending, { status: "pending" });
		expect((await list("statuses=pending")).ids).toEqual([pending]);
		expect((await list("statuses=confirmed")).ids).toEqual([manual]);
		expect((await list("sources=manual")).ids).toEqual([pending, manual]);
		expect((await list("sources=pluggy,receipt")).ids).toEqual([]);
	});

	it("a paginação por cursor mantém o filtro nas páginas seguintes", async () => {
		const { make, list, api } = await seed();
		const expected: string[] = [];
		for (let i = 0; i < 5; i++) {
			expected.unshift(await make({ date: `2026-11-0${i + 1}` }));
			await make({ kind: "income", date: `2026-11-0${i + 1}` });
		}
		const first = await api.get("/v1/transactions?kinds=expense&limit=2");
		expect(first.body.transactions.map((t: { id: string }) => t.id)).toEqual(expected.slice(0, 2));
		expect(first.body.nextCursor).toEqual(expect.any(String));
		const next = (cursor: string) =>
			api.get(`/v1/transactions?kinds=expense&limit=2&cursor=${encodeURIComponent(cursor)}`);
		const second = await next(first.body.nextCursor);
		expect(second.body.transactions.map((t: { id: string }) => t.id)).toEqual(expected.slice(2, 4));
		const third = await next(second.body.nextCursor);
		expect(third.body.transactions.map((t: { id: string }) => t.id)).toEqual(expected.slice(4));
		expect(third.body.nextCursor).toBeNull();
		expect((await list("kinds=expense&limit=100")).ids).toEqual(expected);
	});

	it("parâmetros vazios são ignorados; repetidos contam uma vez", async () => {
		const { make, list } = await seed();
		const id = await make({});
		expect((await list("kinds=&accountIds=&from=")).ids).toEqual([id]);
		expect((await list("kinds=expense,expense")).ids).toEqual([id]);
	});

	it.each([
		["tipo desconhecido", "kinds=pix", "Tipo de lançamento inválido."],
		["origem desconhecida", "sources=fax", "Origem inválida."],
		["situação desconhecida", "statuses=feito", "Situação inválida."],
		["data inválida", "from=2026-02-30", "Data inválida"],
		["período invertido", "from=2026-11-10&to=2026-11-01", "A data inicial não pode ser depois da final."],
		["valor com vírgula", "minCents=10.5", "O valor mínimo deve ser inteiro, em centavos."],
		["valor negativo", "maxCents=-1", "O valor máximo não pode ser negativo."],
		["faixa invertida", "minCents=500&maxCents=100", "O valor mínimo não pode ser maior que o máximo."],
		[
			"lista grande demais",
			`accountIds=${Array.from({ length: 51 }, (_, i) => `a${i}`).join(",")}`,
			"itens demais",
		],
	])("rejeita com 400: %s", async (_name, query, message) => {
		const { list } = await seed();
		const res = await list(query);
		expect(res.status).toBe(400);
		expect(JSON.stringify(res.body)).toContain(message);
	});

	it("sem filtro nada muda", async () => {
		const { make, list } = await seed();
		const a = await make({});
		expect((await list("")).ids).toEqual([a]);
	});
});
