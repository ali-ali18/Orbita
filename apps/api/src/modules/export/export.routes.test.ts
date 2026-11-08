import { describe, expect, it } from "vitest";
import { setupFinance } from "../../test-support.ts";
import { csvCell, csvMoney } from "./service.ts";

describe("csvMoney e csvCell", () => {
	it("formata centavos inteiros sem float", () => {
		expect(csvMoney(0)).toBe("0,00");
		expect(csvMoney(5)).toBe("0,05");
		expect(csvMoney(4690)).toBe("46,90");
		expect(csvMoney(-4690)).toBe("-46,90");
		expect(csvMoney(123_456_789)).toBe("1234567,89");
		expect(() => csvMoney(10.5)).toThrow(RangeError);
	});

	it("protege contra fórmula e escapa separador, aspas e quebra de linha", () => {
		expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
		expect(csvCell("+55 11")).toBe("'+55 11");
		expect(csvCell("-cmd")).toBe("'-cmd");
		expect(csvCell("@soma")).toBe("'@soma");
		expect(csvCell("mercado; padaria")).toBe('"mercado; padaria"');
		expect(csvCell("linha1\nlinha2")).toBe('"linha1\nlinha2"');
		expect(csvCell("Café")).toBe("Café");
		expect(csvCell(null)).toBe("");
		// Número é número: o negativo não leva apóstrofo.
		expect(csvCell(-5)).toBe("-5");
	});
});

async function seed() {
	const ctx = await setupFinance();
	const { api, basics } = ctx;
	const { account, card, category } = await basics();
	await api.post("/v1/transactions", {
		kind: "expense",
		amountCents: 4690,
		date: "2026-11-03",
		description: "iFood; pedido",
		accountId: account.id,
		categoryId: category("mercado"),
	});
	await api.post("/v1/transactions", {
		kind: "income",
		amountCents: 500_000,
		date: "2026-10-05",
		description: "=Salário",
		accountId: account.id,
	});
	await api.post("/v1/transactions", {
		kind: "expense",
		amountCents: 12_000,
		date: "2026-11-04",
		description: "Compra no cartão",
		cardId: card.id,
	});
	await api.post("/v1/recurrences", {
		kind: "expense",
		name: "Streaming",
		amountCents: 3990,
		dayOfMonth: 8,
		startDate: "2026-01-08",
		accountId: account.id,
	});
	return ctx;
}

describe("GET /v1/export", () => {
	it("exige o aparelho pareado", async () => {
		const { call } = await setupFinance();
		expect((await call("GET", "/v1/export?format=json", undefined, null)).status).toBe(401);
	});

	it("JSON: centavos inteiros, tudo que foi pedido e nenhum segredo", async () => {
		const { app, token, vault } = await seed();
		await vault.put("anthropic_api_key", "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789", "Teste");
		const res = await app.request(
			"/v1/export?format=json&include=transactions,categories,accounts,subscriptions",
			{
				headers: { authorization: `Bearer ${token}` },
			},
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("application/json");
		expect(res.headers.get("content-disposition")).toBe('attachment; filename="orbita-2026-11-15.json"');
		expect(res.headers.get("cache-control")).toBe("no-store");
		const text = await res.text();
		expect(text).not.toContain("sk-ant");
		expect(text).not.toContain(token);
		const body = JSON.parse(text);
		expect(body).toMatchObject({
			app: "orbita",
			schemaVersion: 1,
			money: "cents",
			exportedAt: "2026-11-15T15:00:00.000Z",
			period: { from: null, to: null },
		});
		expect(
			body.transactions
				.map((t: { amountCents: number }) => t.amountCents)
				.sort((a: number, b: number) => a - b),
		).toEqual([4690, 12_000, 500_000]);
		expect(body.transactions.every((t: { amountCents: number }) => Number.isInteger(t.amountCents))).toBe(
			true,
		);
		expect(body.categories.length).toBeGreaterThan(0);
		expect(body.accounts).toHaveLength(1);
		expect(body.cards).toHaveLength(1);
		expect(body.subscriptions).toEqual([expect.objectContaining({ name: "Streaming", amountCents: 3990 })]);
	});

	it("JSON: o padrão leva só os lançamentos e o período filtra", async () => {
		const { api } = await seed();
		const only = await api.get("/v1/export?format=json");
		expect(Object.keys(only.body).sort()).toEqual(
			["app", "exportedAt", "money", "period", "schemaVersion", "transactions"].sort(),
		);
		const month = await api.get("/v1/export?format=json&from=2026-11-01&to=2026-11-30");
		expect(month.body.period).toEqual({ from: "2026-11-01", to: "2026-11-30" });
		expect(month.body.transactions).toHaveLength(2);
	});

	it("CSV de lançamentos: BOM, ponto e vírgula, dinheiro formatado e proteção contra fórmula", async () => {
		const { app, token } = await seed();
		const res = await app.request("/v1/export?format=csv", { headers: { authorization: `Bearer ${token}` } });
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
		expect(res.headers.get("content-disposition")).toBe(
			'attachment; filename="orbita-lancamentos-2026-11-15.csv"',
		);
		const bytes = new Uint8Array(await res.arrayBuffer());
		// `text()` descarta o BOM: confere nos bytes que ele está lá (EF BB BF) para o Excel ler UTF-8.
		expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
		const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
		expect(text.startsWith("\uFEFFData;Tipo;Descrição;Valor (R$);")).toBe(true);
		const lines = text.trimEnd().split("\r\n");
		expect(lines).toHaveLength(4);
		expect(lines).toContain('2026-11-03;Saída;"iFood; pedido";-46,90;Mercado;Conta;;;;;Confirmado;Manual;');
		expect(lines.some((l) => l.startsWith("2026-10-05;Entrada;'=Salário;5000,00;"))).toBe(true);
		expect(lines.some((l) => l.includes(";Compra no cartão;-120,00;") && l.includes(";Cartão;"))).toBe(true);
	});

	it("CSV: um tipo de dado por arquivo", async () => {
		const { api, app, token } = await seed();
		const both = await api.get("/v1/export?format=csv&include=transactions,categories");
		expect(both.status).toBe(400);
		expect(both.body.error.message).toContain("um tipo de dado por arquivo");
		const subs = await app.request("/v1/export?format=csv&include=subscriptions", {
			headers: { authorization: `Bearer ${token}` },
		});
		const text = await subs.text();
		expect(text).toContain("Streaming;Saída;-39,90;8;2026-01-08;;");
		const accounts = await app.request("/v1/export?format=csv&include=accounts", {
			headers: { authorization: `Bearer ${token}` },
		});
		expect(await accounts.text()).toContain("Cartão;Cartão;Fecha dia 10, vence dia 20;");
	});

	it("recusa formato, dado e datas inválidos", async () => {
		const { api } = await setupFinance();
		expect((await api.get("/v1/export")).status).toBe(400);
		expect((await api.get("/v1/export?format=xml")).status).toBe(400);
		expect((await api.get("/v1/export?format=json&include=segredos")).status).toBe(400);
		expect((await api.get("/v1/export?format=json&from=ontem")).status).toBe(400);
		expect((await api.get("/v1/export?format=json&from=2026-12-01&to=2026-11-01")).status).toBe(400);
	});

	it("tem limite de pedidos por aparelho", async () => {
		const { api } = await setupFinance();
		for (let i = 0; i < 10; i++) expect((await api.get("/v1/export?format=json")).status).toBe(200);
		expect((await api.get("/v1/export?format=json")).status).toBe(429);
	});
});
