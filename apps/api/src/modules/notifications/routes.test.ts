import { describe, expect, it } from "vitest";
import { setupFinance } from "../../test-support.ts";

const POSTED = Date.parse("2026-11-15T14:00:00Z");
const NU = "com.nu.production";
const COMPRA = "Compra de R$ 23,45 APROVADA em LOJA EXEMPLO para o cartão com final 4821";

async function prepare() {
	const ctx = await setupFinance();
	const { api } = ctx;
	const account = (await api.post("/v1/accounts", { name: "Nubank", kind: "checking", bankCode: "18236120" }))
		.body.account;
	const card = (
		await api.post("/v1/cards", {
			name: "Nubank Mastercard",
			bankCode: "18236120",
			last4: "4821",
			closingDay: 10,
			dueDay: 17,
		})
	).body.card;
	await api.patch("/v1/notification-settings", { capture: true, apps: ["nubank"] });
	const send = (items: unknown[], token: string | null = ctx.token) =>
		ctx.call("POST", "/v1/notifications", { items }, token);
	return { ...ctx, account, card, send };
}

describe("POST /v1/notifications", () => {
	it("exige o token", async () => {
		const { send } = await prepare();
		expect((await send([{ package: NU, text: COMPRA, postedAt: POSTED }], null)).status).toBe(401);
	});

	it("cria o lançamento no cartão pelo final, aguardando o banco, e responde por notificação", async () => {
		const { send, api, card } = await prepare();
		const res = await send([{ package: NU, title: "Compra aprovada", text: COMPRA, postedAt: POSTED }]);
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ results: ["created"] });
		const list = (await api.get("/v1/transactions")).body.transactions;
		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({
			kind: "expense",
			amountCents: 2345,
			description: "LOJA EXEMPLO",
			cardId: card.id,
			source: "notification",
			status: "confirmed",
			bankPending: true,
			date: "2026-11-15",
		});
	});

	it("é idempotente: o mesmo lote duas vezes não duplica", async () => {
		const { send, api } = await prepare();
		const body = [{ package: NU, text: COMPRA, postedAt: POSTED }];
		expect((await send(body)).body.results).toEqual(["created"]);
		expect((await send(body)).body.results).toEqual(["duplicate"]);
		expect((await api.get("/v1/transactions")).body.transactions).toHaveLength(1);
	});

	it("filtra no servidor: pacote de fora, código de verificação e banco desligado", async () => {
		const { send, api } = await prepare();
		const res = await send([
			{ package: "com.whatsapp", text: COMPRA, postedAt: POSTED },
			{ package: NU, text: "Seu código de verificação é 482913", postedAt: POSTED + 1000 },
			{
				package: "br.com.intermedium",
				text: "Compra aprovada: R$ 18,70 em LOJA TESTE no cartão final 7390",
				postedAt: POSTED,
			},
		]);
		expect(res.body.results).toEqual(["ignored", "discarded", "ignored"]);
		expect((await api.get("/v1/transactions")).body.transactions).toEqual([]);
		expect((await api.get("/v1/notifications/inbox")).body.items).toEqual([]);
	});

	it("leitura desligada: ignora tudo", async () => {
		const { send, api } = await prepare();
		await api.patch("/v1/notification-settings", { capture: false });
		expect((await send([{ package: NU, text: COMPRA, postedAt: POSTED }])).body.results).toEqual(["ignored"]);
	});

	it("com 'confirmar antes' o lançamento vai para Para revisar", async () => {
		const { send, api } = await prepare();
		await api.patch("/v1/notification-settings", { askFirst: true });
		await send([{ package: NU, text: COMPRA, postedAt: POSTED }]);
		const pending = (await api.get("/v1/transactions/pending")).body.transactions;
		expect(pending).toHaveLength(1);
		expect(pending[0]).toMatchObject({ amountCents: 2345, status: "pending", source: "notification" });
	});

	it("corta texto grande em vez de recusar, e recusa lote vazio, grande e tipo errado", async () => {
		const { send } = await prepare();
		const big = await send([{ package: NU, text: `${COMPRA} ${"x".repeat(5000)}`, postedAt: POSTED }]);
		expect(big.status).toBe(200);
		expect((await send([])).status).toBe(400);
		const one = { package: NU, text: "oi", postedAt: POSTED };
		expect((await send(Array(11).fill(one))).status).toBe(400);
		expect((await send([{ package: NU, text: "oi", postedAt: "ontem" }])).status).toBe(400);
		expect((await send([{ text: "oi", postedAt: POSTED }])).status).toBe(400);
	});

	it("ordem do Android e data: usa o instante da notificação, não o do servidor", async () => {
		const { send, api } = await prepare();
		await send([{ package: NU, text: COMPRA, postedAt: Date.parse("2026-11-13T02:30:00Z") }]);
		// 23h30 de 12/11 em São Paulo.
		expect((await api.get("/v1/transactions")).body.transactions[0].date).toBe("2026-11-12");
	});

	it("limita os pedidos por aparelho (429)", async () => {
		const { send } = await prepare();
		const body = [{ package: "com.whatsapp", text: "oi", postedAt: POSTED }];
		for (let i = 0; i < 60; i++) expect((await send(body)).status).toBe(200);
		expect((await send(body)).status).toBe(429);
	});
});

describe("lote com item ruim", () => {
	it("um item que falha volta como error e não derruba os outros", async () => {
		const { send, stores } = await prepare();
		const real = stores.transactions.upsertByExternal.bind(stores.transactions);
		let calls = 0;
		stores.transactions.upsertByExternal = async (...args) => {
			if (++calls === 1) throw new Error("falha de teste");
			return real(...args);
		};
		const res = await send([
			{ package: NU, text: COMPRA, postedAt: POSTED },
			{ package: NU, text: "Pix enviado: R$ 17,25 para ANA", postedAt: POSTED + 120_000 },
		]);
		expect(res.status).toBe(200);
		expect(res.body.results).toEqual(["error", "created"]);
	});

	it("horário fora do razoável é recusado pelo esquema (e o aparelho descarta o lote com 400)", async () => {
		const { send } = await prepare();
		expect((await send([{ package: NU, text: COMPRA, postedAt: 5 }])).status).toBe(400);
		expect((await send([{ package: NU, text: COMPRA, postedAt: 9e15 }])).status).toBe(400);
	});

	it("tentar de novo tem limite por aparelho", async () => {
		const { api } = await prepare();
		for (let i = 0; i < 10; i++) expect((await api.post("/v1/notifications/inbox/retry")).status).toBe(200);
		expect((await api.post("/v1/notifications/inbox/retry")).status).toBe(429);
	});
});

describe("lista 'Não entendi'", () => {
	it("guarda o desconhecido com valor, lista, tenta de novo depois do cartão e apaga", async () => {
		const { send, api, call } = await prepare();
		const text = "Compra de R$ 10,00 APROVADA em LOJA Y para o cartão com final 7777";
		const res = await send([
			{ package: NU, title: "Aviso", text: "Algo com R$ 20,00 na sua conta", postedAt: POSTED },
			{ package: NU, text, postedAt: POSTED + 60_000 },
			{ package: NU, text: "Conheça as novidades", postedAt: POSTED + 120_000 },
		]);
		expect(res.body.results).toEqual(["inbox", "inbox", "ignored"]);
		expect((await api.get("/v1/notification-settings")).body.notifications.inbox).toBe(2);
		const { items } = (await api.get("/v1/notifications/inbox")).body;
		expect(items).toHaveLength(2);
		expect(items.map((i: { reason: string }) => i.reason).sort()).toEqual(["format", "target"]);

		expect((await api.post("/v1/notifications/inbox/retry")).body).toEqual({ created: 0, remaining: 2 });
		await api.post("/v1/cards", {
			name: "Nubank Ultra",
			bankCode: "18236120",
			last4: "7777",
			closingDay: 10,
			dueDay: 17,
		});
		expect((await api.post("/v1/notifications/inbox/retry")).body).toEqual({ created: 1, remaining: 1 });
		expect((await api.get("/v1/transactions")).body.transactions).toHaveLength(1);

		const [left] = (await api.get("/v1/notifications/inbox")).body.items;
		expect((await call("DELETE", `/v1/notifications/inbox/${left.id}`)).body).toEqual({ ok: true });
		expect((await call("DELETE", `/v1/notifications/inbox/${left.id}`)).status).toBe(404);
		expect((await api.get("/v1/notifications/inbox")).body.items).toEqual([]);
	});

	it("exige o token", async () => {
		const { call } = await prepare();
		for (const [method, path] of [
			["GET", "/v1/notifications/inbox"],
			["POST", "/v1/notifications/inbox/retry"],
			["DELETE", "/v1/notifications/inbox/x"],
		] as const) {
			expect((await call(method, path, undefined, null)).status).toBe(401);
		}
	});
});
