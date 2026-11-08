import { createMemoryStores } from "@orbita/db";
import { describe, expect, it } from "vitest";
import { requestFingerprint } from "../../http/idempotency.ts";
import { type Json, setupFinance } from "../../test-support.ts";

// Aqui só a memória: os arquivos de teste rodam em paralelo e o Postgres compartilhado é de `postgres.api.test.ts`.
const backends: Array<[string, () => ReturnType<typeof setupFinance>]> = [
	["memória", () => setupFinance(undefined, (now) => createMemoryStores({ now }))],
];

const KEY = "7b0e6b1c-2f4a-4c1e-9d3a-5a8f1c2b3d4e";

describe.each(backends)("Idempotency-Key em lançamentos (%s)", (_name, setup) => {
	async function prepare() {
		const ctx = await setup();
		const { account, card } = await ctx.basics();
		const post = (path: string, body: unknown, key: string | null = KEY) =>
			ctx.app.request(path, {
				method: "POST",
				headers: {
					authorization: `Bearer ${ctx.token}`,
					"content-type": "application/json",
					...(key ? { "idempotency-key": key } : {}),
				},
				body: JSON.stringify(body),
			});
		const count = async () =>
			(await ctx.api.get("/v1/transactions?limit=100")).body.transactions.length as number;
		const body = {
			kind: "expense",
			amountCents: 4590,
			date: "2026-11-14",
			description: "Mercado",
			accountId: account.id,
		};
		return { ...ctx, account, card, post, count, body };
	}

	it("a mesma chave com o mesmo pedido devolve a resposta original e não cria de novo", async () => {
		const { post, count, body } = await prepare();
		const first = await post("/v1/transactions", body);
		expect(first.status).toBe(201);
		const firstJson: Json = await first.json();
		expect(first.headers.get("idempotent-replayed")).toBeNull();

		// A ordem dos campos não muda o pedido.
		const reordered = Object.fromEntries(Object.entries(body).reverse());
		const second = await post("/v1/transactions", reordered);
		expect(second.status).toBe(201);
		expect(second.headers.get("idempotent-replayed")).toBe("true");
		expect(await second.json()).toEqual(firstJson);
		expect(await count()).toBe(1);
	});

	it("a mesma chave com outro pedido é recusada com 422 em pt-BR", async () => {
		const { post, count, body } = await prepare();
		expect((await post("/v1/transactions", body)).status).toBe(201);
		const other = await post("/v1/transactions", { ...body, amountCents: 5000 });
		expect(other.status).toBe(422);
		const json: Json = await other.json();
		expect(json.error.code).toBe("chave_reutilizada");
		expect(json.error.message).toMatch(/outro lançamento/);
		expect(await count()).toBe(1);
	});

	it("a chave vale só para o caminho em que foi usada", async () => {
		const { post, card, body } = await prepare();
		expect((await post("/v1/transactions", body)).status).toBe(201);
		const installments = await post("/v1/transactions/installments", {
			cardId: card.id,
			totalCents: 9000,
			count: 3,
			date: "2026-11-14",
			description: "TV",
		});
		expect(installments.status).toBe(422);
	});

	it("sem o cabeçalho cada pedido cria um lançamento; com cabeçalho inválido é 400", async () => {
		const { post, count, body } = await prepare();
		expect((await post("/v1/transactions", body, null)).status).toBe(201);
		expect((await post("/v1/transactions", body, null)).status).toBe(201);
		expect(await count()).toBe(2);
		const bad = await post("/v1/transactions", body, "nao-e-uuid");
		expect(bad.status).toBe(400);
		expect(((await bad.json()) as Json).error.message).toMatch(/UUID/);
		expect(await count()).toBe(2);
	});

	it("pedido que falha não guarda a chave: depois de corrigir, a mesma chave funciona", async () => {
		const { post, count, body } = await prepare();
		const broken = await post("/v1/transactions", { ...body, accountId: "nao-existe" });
		expect(broken.status).toBeGreaterThanOrEqual(400);
		const invalid = await post("/v1/transactions", { ...body, amountCents: -1 });
		expect(invalid.status).toBe(400);
		expect((await post("/v1/transactions", body)).status).toBe(201);
		expect(await count()).toBe(1);
	});

	it("pedidos simultâneos com a mesma chave criam um lançamento só", async () => {
		const { post, count, body } = await prepare();
		const results = await Promise.all(Array.from({ length: 8 }, () => post("/v1/transactions", body)));
		const statuses = results.map((r) => r.status);
		// Um executa (201); os outros veem a resposta guardada (201) ou "em andamento" (409).
		expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
		expect(statuses.filter((s) => s === 201).length).toBeGreaterThanOrEqual(1);
		expect(await count()).toBe(1);
		for (const r of results.filter((x) => x.status === 409)) {
			expect(((await r.json()) as Json).error.code).toBe("em_andamento");
		}
		// Depois que o primeiro termina, repetir devolve o original.
		const again = await post("/v1/transactions", body);
		expect(again.status).toBe(201);
		expect(await count()).toBe(1);
	});

	it("parcelamento também é idempotente", async () => {
		const { post, card, api } = await prepare();
		const body = { cardId: card.id, totalCents: 9000, count: 3, date: "2026-11-14", description: "TV" };
		const first = (await (await post("/v1/transactions/installments", body)).json()) as Json;
		const second = await post("/v1/transactions/installments", body);
		expect(second.status).toBe(201);
		expect(await second.json()).toEqual(first);
		expect((await api.get("/v1/transactions?limit=100")).body.transactions).toHaveLength(3);
	});
});

describe("requestFingerprint", () => {
	it("ignora a ordem dos campos e distingue método, caminho e conteúdo", () => {
		const a = requestFingerprint("POST", "/x", { a: 1, b: { c: [1, 2], d: null } });
		expect(requestFingerprint("POST", "/x", { b: { d: null, c: [1, 2] }, a: 1 })).toBe(a);
		expect(requestFingerprint("POST", "/x", { a: 1, b: { c: [2, 1], d: null } })).not.toBe(a);
		expect(requestFingerprint("POST", "/y", { a: 1, b: { c: [1, 2], d: null } })).not.toBe(a);
		expect(requestFingerprint("PUT", "/x", { a: 1, b: { c: [1, 2], d: null } })).not.toBe(a);
	});
});
