import { describe, expect, it } from "vitest";
import { createPluggyClient, PLUGGY_BASE_URL, type PluggyFetch } from "./client.ts";
import { PluggyError } from "./errors.ts";
import {
	API_KEY,
	BANK_ACCOUNT_ID,
	CARD_ACCOUNT_ID,
	CLIENT_ID,
	CLIENT_SECRET,
	CONNECT_TOKEN,
	fakePluggy,
	ITEM_ID,
	tx,
} from "./fake-pluggy.ts";

const make = (fetch: PluggyFetch, extra: object = {}) =>
	createPluggyClient({ fetch, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, ...extra });

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("createPluggyClient", () => {
	it("autentica uma vez, reaproveita a apiKey e manda só para api.pluggy.ai", async () => {
		const fake = fakePluggy();
		const client = make(fake.fetch);
		const item = await client.item(ITEM_ID);
		expect(item).toMatchObject({ id: ITEM_ID, status: "UPDATED", connector: { name: "Nubank" } });
		await client.accounts(ITEM_ID);

		const auths = fake.requests.filter((r) => r.url.pathname === "/auth");
		expect(auths).toHaveLength(1);
		expect(JSON.parse(auths[0]?.body ?? "{}")).toEqual({
			clientId: CLIENT_ID,
			clientSecret: CLIENT_SECRET,
			nonExpiring: false,
		});
		for (const r of fake.requests) expect(r.url.origin).toBe(PLUGGY_BASE_URL);
		expect(
			fake.requests
				.filter((r) => r.url.pathname !== "/auth")
				.every((r) => r.headers["x-api-key"] === API_KEY),
		).toBe(true);
	});

	it("pede o token do widget com clientUserId e devolve só o accessToken", async () => {
		const fake = fakePluggy();
		const token = await make(fake.fetch).connectToken("orbita");
		expect(token).toBe(CONNECT_TOKEN);
		const req = fake.requests.find((r) => r.url.pathname === "/connect_token");
		expect(req?.method).toBe("POST");
		expect(req?.headers["x-api-key"]).toBe(API_KEY);
		expect(JSON.parse(req?.body ?? "{}")).toEqual({ options: { clientUserId: "orbita" } });
		await expect(make(fake.fetch).connectToken("a/b")).rejects.toThrow(RangeError);
	});

	it("pede token de atualização com o itemId no corpo e recusa itemId que não é UUID", async () => {
		const fake = fakePluggy();
		await make(fake.fetch).connectToken("orbita", ITEM_ID);
		const req = fake.requests.filter((r) => r.url.pathname === "/connect_token").at(-1);
		expect(JSON.parse(req?.body ?? "{}")).toEqual({ itemId: ITEM_ID, options: { clientUserId: "orbita" } });
		await expect(make(fake.fetch).connectToken("orbita", "../x")).rejects.toThrow();
	});

	it("lê createdAt e connector.isSandbox do item", async () => {
		const fake = fakePluggy({ item: { connector: { name: "Banco Teste", isSandbox: true } } });
		const item = await make(fake.fetch).item(ITEM_ID);
		expect(item.createdAt).toBe("2026-11-01T08:00:00.000Z");
		expect(item.connector).toEqual({ name: "Banco Teste", isSandbox: true });
	});

	it("renova a apiKey depois de 100 min", async () => {
		const fake = fakePluggy();
		let t = new Date("2026-11-07T09:00:00Z").getTime();
		const client = make(fake.fetch, { now: () => new Date(t) });
		await client.item(ITEM_ID);
		t += 99 * 60_000;
		await client.item(ITEM_ID);
		expect(fake.requests.filter((r) => r.url.pathname === "/auth")).toHaveLength(1);
		t += 2 * 60_000;
		await client.item(ITEM_ID);
		expect(fake.requests.filter((r) => r.url.pathname === "/auth")).toHaveLength(2);
	});

	it("se a apiKey for recusada no meio, autentica de novo uma vez", async () => {
		const fake = fakePluggy();
		let first = true;
		const flaky: PluggyFetch = async (url, init) => {
			if (new URL(url).pathname.startsWith("/items") && first) {
				first = false;
				return new Response("{}", { status: 401 });
			}
			return fake.fetch(url, init);
		};
		await expect(make(flaky).item(ITEM_ID)).resolves.toMatchObject({ id: ITEM_ID });
		expect(fake.requests.filter((r) => r.url.pathname === "/auth")).toHaveLength(2);
	});

	it("chave errada: erro claro que não repete o segredo nem o corpo da resposta", async () => {
		const fake = fakePluggy();
		const client = createPluggyClient({
			fetch: fake.fetch,
			clientId: CLIENT_ID,
			clientSecret: "errado-errado",
		});
		const error = await client.item(ITEM_ID).catch((e) => e);
		expect(error).toBeInstanceOf(PluggyError);
		expect(error).toMatchObject({ code: "auth", status: 401 });
		expect(error.message).toContain("Client ID e o Client Secret");
		expect(error.message).not.toContain("errado-errado");
		expect(error.message).not.toContain(CLIENT_ID);
	});

	it("pagina lançamentos por cursor (/v2/transactions) até o fim, filtrando por dia", async () => {
		const many = Array.from({ length: 5 }, (_, i) => tx(`t-${i}`, { amount: i + 1 }));
		const old = tx("antigo", { date: "2026-01-01T00:00:00.000Z" });
		const fake = fakePluggy({ cursorPageSize: 2, transactions: { [BANK_ACCOUNT_ID]: [old, ...many] } });
		const all = await make(fake.fetch).transactions({
			accountId: BANK_ACCOUNT_ID,
			from: "2026-08-09",
			to: "2026-11-07",
		});
		expect(all.dropped).toBe(0);
		expect(all.transactions.map((t) => t.id)).toEqual(["t-0", "t-1", "t-2", "t-3", "t-4"]);
		const calls = fake.requests.filter((r) => r.url.pathname === "/v2/transactions");
		expect(calls).toHaveLength(3);
		expect(calls[0]?.url.searchParams.get("after")).toBeNull();
		expect(calls[1]?.url.searchParams.get("after")).not.toBeNull();
		expect(calls[0]?.url.searchParams.get("dateFrom")).toBe("2026-08-09");
		expect(calls[0]?.url.searchParams.get("dateTo")).toBe("2026-11-07");
		expect(calls[0]?.url.searchParams.get("accountId")).toBe(BANK_ACCOUNT_ID);
		for (const r of fake.requests) expect(r.url.origin).toBe(PLUGGY_BASE_URL);
	});

	it("cursor que não avança é resposta inválida (nada de laço infinito)", async () => {
		const stuck = { results: [tx("t", {})], next: "/v2/transactions?after=igual" };
		const fake = fakePluggy({
			override: (url) => (url.pathname === "/v2/transactions" ? ok(stuck) : undefined),
		});
		await expect(
			make(fake.fetch).transactions({ accountId: BANK_ACCOUNT_ID, from: "2026-08-09", to: "2026-11-07" }),
		).rejects.toMatchObject({ code: "invalid_response" });
	});

	it("pagina contas por página e lê os pagamentos das faturas do cartão", async () => {
		const bill = {
			id: "b-1",
			dueDate: "2026-11-17T00:00:00.000Z",
			payments: [{ id: "p", paymentDate: "2026-11-16T00:00:00.000Z", amount: 830.1 }],
		};
		const fake = fakePluggy({ pageSize: 1, bills: { [CARD_ACCOUNT_ID]: [bill, { ...bill, id: "b-2" }] } });
		const client = make(fake.fetch);
		expect((await client.accounts(ITEM_ID)).map((a) => a.id)).toEqual([BANK_ACCOUNT_ID, CARD_ACCOUNT_ID]);
		const bills = await client.bills(CARD_ACCOUNT_ID);
		expect(bills.map((b) => b.id)).toEqual(["b-1", "b-2"]);
		expect(bills[0]?.payments[0]?.amount).toBe(830.1);
		const pages = fake.requests
			.filter((r) => r.url.pathname === "/accounts")
			.map((r) => r.url.searchParams.get("page"));
		expect(pages).toEqual(["1", "2"]);
	});

	it("manda nonExpiring:false e renova a apiKey perto do exp do JWT", async () => {
		const start = new Date("2026-11-07T09:00:00Z");
		const exp = Math.floor(start.getTime() / 1000) + 10 * 60; // vence em 10 min
		const jwt = `h.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.s`;
		const fake = fakePluggy({
			override: (url) => (url.pathname === "/auth" ? ok({ apiKey: jwt }) : undefined),
		});
		let t = start.getTime();
		const client = make(fake.fetch, { now: () => new Date(t) });
		await client.item(ITEM_ID).catch(() => {}); // a fake não aceita este JWT; só importa a autenticação
		const auths = () => fake.requests.filter((r) => r.url.pathname === "/auth");
		expect(JSON.parse(auths()[0]?.body ?? "{}")).toEqual({
			clientId: CLIENT_ID,
			clientSecret: CLIENT_SECRET,
			nonExpiring: false,
		});
		t += 5 * 60_000; // ainda dentro da validade
		await client.item(ITEM_ID).catch(() => {});
		const afterFive = auths().length;
		t += 4.5 * 60_000; // 9,5 min: dentro da folga de 1 min antes do exp
		await client.item(ITEM_ID).catch(() => {});
		expect(auths().length).toBeGreaterThan(afterFive);
	});

	it("resposta fora do formato é erro claro (campo obrigatório ausente, tipo errado)", async () => {
		const bad = [
			{ results: "nada", next: null },
			{ results: [], page: 1, totalPages: 1 }, // formato de página no endpoint de cursor
			{ nada: true },
		];
		for (const body of bad) {
			const fake = fakePluggy({
				override: (url) => (url.pathname === "/v2/transactions" ? ok(body) : undefined),
			});
			const error = await make(fake.fetch)
				.transactions({ accountId: BANK_ACCOUNT_ID, from: "2026-08-09", to: "2026-11-07" })
				.catch((e) => e);
			expect(error).toMatchObject({ name: "PluggyError", code: "invalid_response" });
		}
		const noKey = fakePluggy({
			override: (url) => (url.pathname === "/auth" ? ok({ token: "x" }) : undefined),
		});
		await expect(make(noKey.fetch).item(ITEM_ID)).rejects.toMatchObject({ code: "invalid_response" });
	});

	it("linha fora do formato é descartada e contada; o resto da página fica", async () => {
		const rows = [
			tx("ok-1", {}),
			{ id: "sem-valor", date: "2026-11-03T00:00:00.000Z" }, // falta amount/date/type
			tx("amount-torto", { amount: { v: 1 } }),
			"lixo",
			null,
			tx("ok-2", { amount: 2 }),
		];
		const fake = fakePluggy({ transactions: { [BANK_ACCOUNT_ID]: rows as never } });
		const res = await make(fake.fetch).transactions({
			accountId: BANK_ACCOUNT_ID,
			from: "2026-08-09",
			to: "2026-11-12",
		});
		expect(res.transactions.map((t) => t.id)).toEqual(["ok-1", "ok-2"]);
		expect(res.dropped).toBe(4);
	});

	it("corpo que não é JSON é resposta inválida", async () => {
		const fake = fakePluggy({
			override: (url) => (url.pathname.startsWith("/items") ? new Response("<html>") : undefined),
		});
		await expect(make(fake.fetch).item(ITEM_ID)).rejects.toMatchObject({ code: "invalid_response" });
	});

	it("traduz status HTTP", async () => {
		for (const [status, code] of [
			[403, "forbidden"],
			[404, "not_found"],
			[429, "rate_limit"],
			[503, "unavailable"],
			[418, "http"],
		] as const) {
			const fake = fakePluggy({
				override: (url) =>
					url.pathname.startsWith("/items") ? new Response("segredo-no-corpo", { status }) : undefined,
			});
			const error = await make(fake.fetch)
				.item(ITEM_ID)
				.catch((e) => e);
			expect(error).toMatchObject({ code, status });
			expect(error.message).not.toContain("segredo-no-corpo");
		}
	});

	it("corta resposta grande demais, pelo cabeçalho e pelo corpo", async () => {
		const huge = JSON.stringify({ results: [], page: 1, totalPages: 1, lixo: "x".repeat(2000) });
		const byHeader = fakePluggy({
			override: (url) =>
				url.pathname === "/accounts"
					? new Response("{}", { headers: { "content-length": "999999" } })
					: undefined,
		});
		await expect(make(byHeader.fetch, { maxBytes: 1000 }).accounts(ITEM_ID)).rejects.toMatchObject({
			code: "too_large",
		});
		const byBody = fakePluggy({
			override: (url) => (url.pathname === "/accounts" ? new Response(huge) : undefined),
		});
		await expect(make(byBody.fetch, { maxBytes: 1000 }).accounts(ITEM_ID)).rejects.toMatchObject({
			code: "too_large",
		});
	});

	it("estoura o tempo", async () => {
		const hang: PluggyFetch = (_url, init) =>
			new Promise((_resolve, reject) => {
				init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
			});
		await expect(make(hang, { timeoutMs: 20 }).item(ITEM_ID)).rejects.toMatchObject({ code: "timeout" });
	});

	it("falha de rede vira erro sem o detalhe de baixo nível", async () => {
		const down: PluggyFetch = async () => {
			throw new Error(`connect ECONNREFUSED ${CLIENT_SECRET}`);
		};
		const error = await make(down)
			.item(ITEM_ID)
			.catch((e) => e);
		expect(error).toMatchObject({ code: "network" });
		expect(error.message).not.toContain(CLIENT_SECRET);
	});

	it("não segue redirecionamento e recusa id que não cabe no caminho da URL", async () => {
		const fake = fakePluggy();
		const client = make(fake.fetch);
		await client.item(ITEM_ID);
		expect(fake.requests.length).toBeGreaterThan(0);
		await expect(client.item("../../auth")).rejects.toThrow(RangeError);
		await expect(
			client.transactions({ accountId: "a/b?x", from: "2026-01-01", to: "2026-01-02" }),
		).rejects.toThrow(RangeError);
		await expect(client.transactions({ accountId: "ok", from: "ontem", to: "2026-01-02" })).rejects.toThrow(
			RangeError,
		);
		let redirect: RequestInit["redirect"];
		const spy: PluggyFetch = async (url, init) => {
			redirect = init.redirect;
			return fake.fetch(url, init);
		};
		await make(spy).item(ITEM_ID);
		expect(redirect).toBe("error");
	});
});

describe("categories", () => {
	it("lê a árvore de categorias, todas as páginas, validada", async () => {
		const fake = fakePluggy({
			pageSize: 1,
			categories: [
				{ id: "03000000", description: "Investments" },
				{
					id: "03020000",
					description: "Fixed income",
					parentId: "03000000",
					parentDescription: "Investments",
				},
			],
		});
		const client = createPluggyClient({
			fetch: fake.fetch,
			clientId: CLIENT_ID,
			clientSecret: CLIENT_SECRET,
		});
		expect((await client.categories()).map((c) => c.id)).toEqual(["03000000", "03020000"]);
	});

	it("formato inesperado vira invalid_response", async () => {
		const fake = fakePluggy({ categories: [{ nome: "x" }] });
		const client = createPluggyClient({
			fetch: fake.fetch,
			clientId: CLIENT_ID,
			clientSecret: CLIENT_SECRET,
		});
		await expect(client.categories()).rejects.toMatchObject({ code: "invalid_response" });
	});
});
