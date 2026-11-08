import { describe, expect, it } from "vitest";
import { setupFinance } from "../test-support.ts";

describe("contas", () => {
	it("cria, lista, lê, edita e arquiva", async () => {
		const { api } = await setupFinance();
		const created = await api.post("/v1/accounts", {
			name: " Nubank ",
			kind: "checking",
			bankCode: "18236120",
		});
		expect(created.status).toBe(201);
		const { id } = created.body.account;
		expect(created.body.account).toMatchObject({ name: "Nubank", kind: "checking", archivedAt: null });

		expect((await api.get("/v1/accounts")).body.accounts).toHaveLength(1);
		expect((await api.get(`/v1/accounts/${id}`)).body.account.name).toBe("Nubank");

		const patched = await api.patch(`/v1/accounts/${id}`, { name: "Roxinho" });
		expect(patched.body.account.name).toBe("Roxinho");
		expect(patched.body.account.kind).toBe("checking");

		const archived = await api.delete(`/v1/accounts/${id}`);
		expect(archived.status).toBe(200);
		expect(archived.body.account.archivedAt).not.toBeNull();
		expect((await api.get("/v1/accounts")).body.accounts).toHaveLength(0);
		expect((await api.get(`/v1/accounts/${id}`)).status).toBe(200);
	});

	it("valida corpo, campo extra, id grande e JSON torto; desconhecida dá 404", async () => {
		const { api, call } = await setupFinance();
		expect((await api.post("/v1/accounts", { name: "", kind: "checking" })).status).toBe(400);
		expect((await api.post("/v1/accounts", { name: "A", kind: "cripto" })).status).toBe(400);
		expect((await api.post("/v1/accounts", { name: "A", kind: "wallet", extra: 1 })).status).toBe(400);
		expect((await api.get(`/v1/accounts/${"x".repeat(65)}`)).status).toBe(400);
		const bad = await call("POST", "/v1/accounts", "{nao e json");
		expect(bad.status).toBe(400);
		expect(bad.body.error.code).toBe("dados_invalidos");
		const missing = await api.get("/v1/accounts/nao-existe");
		expect(missing.status).toBe(404);
		expect(missing.body.error).toEqual({ code: "nao_encontrado", message: "Conta não encontrada." });
		expect((await api.patch("/v1/accounts/nao-existe", { name: "X" })).status).toBe(404);
		expect((await api.delete("/v1/accounts/nao-existe")).status).toBe(404);
	});
});

describe("cartões", () => {
	it("cria com regra padrão, edita e arquiva", async () => {
		const { api } = await setupFinance();
		const created = await api.post("/v1/cards", {
			name: "Visa",
			closingDay: 10,
			dueDay: 20,
			limitCents: 500000,
		});
		expect(created.status).toBe(201);
		expect(created.body.card).toMatchObject({ closingRule: "closing-day-next", limitCents: 500000 });
		const { id } = created.body.card;
		expect((await api.patch(`/v1/cards/${id}`, { dueDay: 25 })).body.card).toMatchObject({
			dueDay: 25,
			closingRule: "closing-day-next",
		});
		expect((await api.get(`/v1/cards/${id}`)).status).toBe(200);
		expect((await api.delete(`/v1/cards/${id}`)).body.card.archivedAt).not.toBeNull();
		expect((await api.get("/v1/cards")).body.cards).toHaveLength(0);
	});

	it("valida os dias", async () => {
		const { api } = await setupFinance();
		expect((await api.post("/v1/cards", { name: "Visa", closingDay: 0, dueDay: 20 })).status).toBe(400);
		expect((await api.post("/v1/cards", { name: "Visa", closingDay: 10, dueDay: 32 })).status).toBe(400);
		expect((await api.get("/v1/cards/nao-existe")).status).toBe(404);
	});
});

describe("categorias", () => {
	it("lista as padrão, cria, edita e arquiva; slug repetido é 409", async () => {
		const { api } = await setupFinance();
		const list = (await api.get("/v1/categories")).body.categories as { slug: string }[];
		expect(list.map((c) => c.slug)).toContain("mercado");

		const created = await api.post("/v1/categories", { slug: "pets", name: "Pets" });
		expect(created.status).toBe(201);
		const { id } = created.body.category;
		expect(
			(await api.patch(`/v1/categories/${id}`, { name: "Bichos", chartSlot: 2 })).body.category,
		).toMatchObject({
			name: "Bichos",
			chartSlot: 2,
		});
		const dup = await api.post("/v1/categories", { slug: "pets", name: "Outro" });
		expect(dup.status).toBe(409);
		expect(dup.body.error.message).toBe("Já existe uma categoria com este identificador.");
		expect((await api.delete(`/v1/categories/${id}`)).body.category.archivedAt).not.toBeNull();
		expect((await api.post("/v1/categories", { slug: "Slug Ruim", name: "x" })).status).toBe(400);
	});

	it("categoria do sistema não se arquiva", async () => {
		const { api } = await setupFinance();
		const outros = ((await api.get("/v1/categories")).body.categories as { id: string; slug: string }[]).find(
			(c) => c.slug === "outros",
		);
		const res = await api.delete(`/v1/categories/${outros?.id}`);
		expect(res.status).toBe(400);
		expect(res.body.error.message).toBe("Categoria do sistema não pode ser arquivada.");
	});
});

describe("orçamentos", () => {
	it("define, troca, lista e remove", async () => {
		const { api, basics } = await setupFinance();
		const { category } = await basics();
		expect(
			(await api.put("/v1/budgets", { scope: "total", limitCents: 500000 })).body.budget.limitCents,
		).toBe(500000);
		expect(
			(await api.put("/v1/budgets", { scope: "total", limitCents: 600000 })).body.budget.limitCents,
		).toBe(600000);
		await api.put("/v1/budgets", { scope: category("mercado"), limitCents: 80000 });
		expect((await api.get("/v1/budgets")).body.budgets).toHaveLength(2);

		expect((await api.delete(`/v1/budgets/${category("mercado")}`)).status).toBe(204);
		expect((await api.delete(`/v1/budgets/${category("mercado")}`)).status).toBe(404);
	});

	it("rejeita escopo inexistente e limite negativo", async () => {
		const { api } = await setupFinance();
		const bad = await api.put("/v1/budgets", { scope: "nao-existe", limitCents: 1000 });
		expect(bad.status).toBe(400);
		expect(bad.body.error.message).toBe("O orçamento vale para o total ou para uma categoria que existe.");
		expect((await api.put("/v1/budgets", { scope: "total", limitCents: -1 })).status).toBe(400);
		expect((await api.put("/v1/budgets", { scope: "total", limitCents: 10.5 })).status).toBe(400);
	});
});

describe("recorrências", () => {
	it("cria, lista, lê, edita e arquiva", async () => {
		const { api, basics } = await setupFinance();
		const { account } = await basics();
		const created = await api.post("/v1/recurrences", {
			kind: "expense",
			name: "Aluguel",
			amountCents: 150000,
			dayOfMonth: 5,
			startDate: "2026-01-01",
			accountId: account.id,
		});
		expect(created.status).toBe(201);
		const { id } = created.body.recurrence;
		expect((await api.get("/v1/recurrences")).body.recurrences).toHaveLength(1);
		expect((await api.get(`/v1/recurrences/${id}`)).body.recurrence.name).toBe("Aluguel");
		expect(
			(await api.patch(`/v1/recurrences/${id}`, { amountCents: 160000 })).body.recurrence.amountCents,
		).toBe(160000);
		expect((await api.delete(`/v1/recurrences/${id}`)).body.recurrence.archivedAt).not.toBeNull();
		expect((await api.get("/v1/recurrences")).body.recurrences).toHaveLength(0);
	});

	it("guarda o lembrete de 1 dia antes (desligado por padrão) e valida o tipo", async () => {
		const { api, basics } = await setupFinance();
		const { account } = await basics();
		const base = {
			kind: "expense",
			name: "Netflix",
			amountCents: 4490,
			dayOfMonth: 18,
			startDate: "2026-01-01",
			accountId: account.id,
		};
		const plain = await api.post("/v1/recurrences", base);
		expect(plain.body.recurrence.remindDayBefore).toBe(false);
		const withReminder = await api.post("/v1/recurrences", { ...base, remindDayBefore: true });
		expect(withReminder.body.recurrence.remindDayBefore).toBe(true);
		const { id } = withReminder.body.recurrence;
		expect(
			(await api.patch(`/v1/recurrences/${id}`, { remindDayBefore: false })).body.recurrence.remindDayBefore,
		).toBe(false);
		expect((await api.get(`/v1/recurrences/${id}`)).body.recurrence.remindDayBefore).toBe(false);
		expect((await api.post("/v1/recurrences", { ...base, remindDayBefore: "sim" })).status).toBe(400);
	});

	it("exige conta ou cartão (um só) e fim depois do início", async () => {
		const { api, basics } = await setupFinance();
		const { account, card } = await basics();
		const base = { kind: "expense", name: "X", amountCents: 100, dayOfMonth: 5, startDate: "2026-01-01" };
		expect((await api.post("/v1/recurrences", base)).status).toBe(400);
		expect(
			(await api.post("/v1/recurrences", { ...base, accountId: account.id, cardId: card.id })).status,
		).toBe(400);
		expect(
			(await api.post("/v1/recurrences", { ...base, accountId: account.id, endDate: "2025-01-01" })).status,
		).toBe(400);
	});
});

describe("lançamentos", () => {
	it("à vista na conta: cria, lê, edita, confirma e apaga", async () => {
		const { api, basics, stores } = await setupFinance();
		const { account, category } = await basics();
		const manual = await api.post("/v1/transactions", {
			kind: "expense",
			amountCents: 4590,
			date: "2026-11-14",
			description: "Mercado",
			accountId: account.id,
			categoryId: category("mercado"),
		});
		expect(manual.status).toBe(201);
		// Lançamento manual nasce confirmado; o cliente não escolhe a situação nem o mês do orçamento.
		expect(manual.body.transaction).toMatchObject({
			budgetMonth: "2026-11",
			invoiceMonth: null,
			status: "confirmed",
		});
		const body = {
			kind: "expense",
			amountCents: 1,
			date: "2026-11-14",
			description: "x",
			accountId: account.id,
		};
		expect((await api.post("/v1/transactions", { ...body, status: "pending" })).status).toBe(400);
		expect((await api.post("/v1/transactions", { ...body, budgetMonth: "2026-01" })).status).toBe(400);
		expect(
			(await api.patch(`/v1/transactions/${manual.body.transaction.id}`, { status: "pending" })).status,
		).toBe(400);
		expect(
			(await api.patch(`/v1/transactions/${manual.body.transaction.id}`, { budgetMonth: "2026-01" })).status,
		).toBe(400);

		// Pendente só chega pela ingestão (store); `/confirm` é o único jeito de confirmar.
		const { id } = await stores.transactions.create({
			kind: "expense",
			amountCents: 4590,
			date: "2026-11-14",
			description: "Notificação",
			accountId: account.id,
			status: "pending",
		});

		expect((await api.get(`/v1/transactions/${id}`)).status).toBe(200);
		const edited = await api.patch(`/v1/transactions/${id}`, { amountCents: 5000, note: "feira" });
		expect(edited.body.transaction).toMatchObject({ amountCents: 5000, note: "feira" });

		const confirmed = await api.post(`/v1/transactions/${id}/confirm`);
		expect(confirmed.body.transaction.status).toBe("confirmed");
		expect((await api.post(`/v1/transactions/${id}/confirm`)).status).toBe(200);

		expect((await api.delete(`/v1/transactions/${id}`)).body).toEqual({ deleted: 1 });
		expect((await api.get(`/v1/transactions/${id}`)).status).toBe(404);
		expect((await api.delete(`/v1/transactions/${id}`)).status).toBe(404);
	});

	it("compra no cartão: o servidor calcula a fatura; o cliente não pode mandar", async () => {
		const { api, basics } = await setupFinance();
		const { card } = await basics();
		const body = {
			kind: "expense",
			amountCents: 1000,
			date: "2026-11-15",
			description: "Loja",
			cardId: card.id,
		};
		// Fecha dia 10: compra do dia 15 vai para a fatura que vence em dezembro.
		const created = await api.post("/v1/transactions", body);
		expect(created.body.transaction.invoiceMonth).toBe("2026-12");
		const before = await api.post("/v1/transactions", { ...body, date: "2026-11-05" });
		expect(before.body.transaction.invoiceMonth).toBe("2026-11");

		const forged = await api.post("/v1/transactions", { ...body, invoiceMonth: "2030-01" });
		expect(forged.status).toBe(400);
	});

	it("trocar a data de compra no cartão refaz a fatura; sair do cartão limpa", async () => {
		const { api, basics } = await setupFinance();
		const { card, account } = await basics();
		const { id } = (
			await api.post("/v1/transactions", {
				kind: "expense",
				amountCents: 1000,
				date: "2026-11-15",
				description: "Loja",
				cardId: card.id,
			})
		).body.transaction;
		const moved = await api.patch(`/v1/transactions/${id}`, { date: "2026-11-05" });
		expect(moved.body.transaction).toMatchObject({ invoiceMonth: "2026-11", budgetMonth: "2026-11" });
		const toAccount = await api.patch(`/v1/transactions/${id}`, { cardId: null, accountId: account.id });
		expect(toAccount.body.transaction).toMatchObject({ invoiceMonth: null, cardId: null });
	});

	it("estorno no cartão também ganha fatura; pagamento de fatura não tem", async () => {
		const { api, basics } = await setupFinance();
		const { card, account } = await basics();
		const purchase = (
			await api.post("/v1/transactions", {
				kind: "expense",
				amountCents: 9000,
				date: "2026-10-20",
				description: "Loja",
				cardId: card.id,
			})
		).body.transaction;
		const refund = await api.post("/v1/transactions", {
			kind: "refund",
			amountCents: 3000,
			date: "2026-11-12",
			description: "Estorno",
			cardId: card.id,
			refundOfId: purchase.id,
		});
		expect(refund.status).toBe(201);
		expect(refund.body.transaction.invoiceMonth).toBe("2026-12");
		const payment = await api.post("/v1/transactions", {
			kind: "card_payment",
			amountCents: 9000,
			date: "2026-11-20",
			description: "Fatura",
			cardId: card.id,
			accountId: account.id,
		});
		expect(payment.body.transaction.invoiceMonth).toBeNull();
	});

	it("valida os campos do lançamento", async () => {
		const { api, basics } = await setupFinance();
		const { account, card } = await basics();
		const ok = {
			kind: "expense",
			amountCents: 1000,
			date: "2026-11-15",
			description: "X",
			accountId: account.id,
		};
		expect((await api.post("/v1/transactions", { ...ok, amountCents: 10.5 })).status).toBe(400);
		expect((await api.post("/v1/transactions", { ...ok, amountCents: 0 })).status).toBe(400);
		expect((await api.post("/v1/transactions", { ...ok, date: "2026-02-30" })).status).toBe(400);
		expect((await api.post("/v1/transactions", { ...ok, accountId: undefined })).status).toBe(400);
		expect((await api.post("/v1/transactions", { ...ok, cardId: card.id })).status).toBe(400);
		expect(
			(await api.post("/v1/transactions", { ...ok, kind: "transfer", counterpartAccountId: ok.accountId }))
				.status,
		).toBe(400);
		// Sem destino é válido: "outra conta sua, não identificada".
		expect((await api.post("/v1/transactions", { ...ok, kind: "transfer" })).status).toBe(201);
		expect((await api.patch("/v1/transactions/x", { source: "pluggy" })).status).toBe(400);
		expect((await api.get("/v1/transactions/month/2026-13")).status).toBe(400);
		expect((await api.get("/v1/transactions?limit=101")).status).toBe(400);
		expect((await api.get("/v1/transactions?cursor=lixo")).status).toBe(400);
	});

	it("parcelado: gera o grupo, valida a contagem, apaga o grupo", async () => {
		const { api, basics } = await setupFinance();
		const { card, category } = await basics();
		const body = {
			cardId: card.id,
			totalCents: 10000,
			count: 3,
			date: "2026-11-15",
			description: "Notebook",
			categoryId: category("lazer"),
		};
		const created = await api.post("/v1/transactions/installments", body);
		expect(created.status).toBe(201);
		const rows = created.body.transactions as {
			amountCents: number;
			invoiceMonth: string;
			budgetMonth: string;
			installmentNumber: number;
			installmentGroupId: string;
			categoryId: string;
		}[];
		expect(rows.map((r) => r.amountCents)).toEqual([3334, 3333, 3333]);
		expect(rows.map((r) => r.invoiceMonth)).toEqual(["2026-12", "2027-01", "2027-02"]);
		expect(rows.map((r) => r.budgetMonth)).toEqual(["2026-11", "2026-12", "2027-01"]);
		expect(new Set(rows.map((r) => r.installmentGroupId)).size).toBe(1);
		expect(created.body.groupId).toBe(rows[0]?.installmentGroupId);

		for (const count of [1, 73, 2.5]) {
			expect((await api.post("/v1/transactions/installments", { ...body, count })).status).toBe(400);
		}
		expect((await api.post("/v1/transactions/installments", { ...body, totalCents: 2 })).status).toBe(400);
		expect((await api.post("/v1/transactions/installments", { ...body, cardId: "nao-existe" })).status).toBe(
			422,
		);

		const second = rows[1];
		// Sem scope=group, só a parcela.
		expect(
			(
				await api.delete(
					`/v1/transactions/${(await api.get("/v1/transactions/month/2026-12")).body.transactions[0].id}`,
				)
			).body,
		).toEqual({ deleted: 1 });
		const groupDelete = await api.delete(
			`/v1/transactions/${(await api.get("/v1/transactions/month/2027-01")).body.transactions[0].id}?scope=group`,
		);
		expect(groupDelete.body).toEqual({ deleted: 2 });
		expect(second).toBeDefined();
		expect((await api.get("/v1/transactions/month/2026-11")).body.transactions).toHaveLength(0);
	});

	it("scope=group num lançamento que não é parcela dá 400", async () => {
		const { api, basics } = await setupFinance();
		const { account } = await basics();
		const { id } = (
			await api.post("/v1/transactions", {
				kind: "expense",
				amountCents: 100,
				date: "2026-11-15",
				description: "X",
				accountId: account.id,
			})
		).body.transaction;
		expect((await api.delete(`/v1/transactions/${id}?scope=group`)).status).toBe(400);
		expect((await api.delete(`/v1/transactions/${id}?scope=tudo`)).status).toBe(400);
	});

	it("lista recentes com cursor, por mês e pendentes", async () => {
		const { api, basics, stores } = await setupFinance();
		const { account } = await basics();
		const make = (date: string, status: "confirmed" | "pending" = "confirmed") =>
			stores.transactions.create({
				kind: "expense",
				amountCents: 100,
				date,
				description: date,
				accountId: account.id,
				status,
			});
		await make("2026-11-10");
		await make("2026-11-12", "pending");
		await make("2026-11-14");
		await make("2026-10-30");

		const first = await api.get("/v1/transactions?limit=3");
		expect(first.body.transactions.map((t: { date: string }) => t.date)).toEqual([
			"2026-11-14",
			"2026-11-12",
			"2026-11-10",
		]);
		expect(first.body.nextCursor).toEqual(expect.any(String));
		const second = await api.get(`/v1/transactions?limit=3&cursor=${first.body.nextCursor}`);
		expect(second.body.transactions.map((t: { date: string }) => t.date)).toEqual(["2026-10-30"]);
		expect(second.body.nextCursor).toBeNull();
		const exact = await api.get("/v1/transactions?limit=4");
		expect(exact.body.nextCursor).toBeNull();

		expect((await api.get("/v1/transactions/month/2026-11")).body.transactions).toHaveLength(3);
		const pending = await api.get("/v1/transactions/pending");
		expect(pending.body.transactions.map((t: { date: string }) => t.date)).toEqual(["2026-11-12"]);
		expect(pending.body.hasMore).toBe(false);

		await make("2026-11-13", "pending");
		await make("2026-11-11", "pending");
		const page = await api.get("/v1/transactions/pending?limit=2");
		expect(page.body.transactions.map((t: { date: string }) => t.date)).toEqual(["2026-11-13", "2026-11-12"]);
		expect(page.body.hasMore).toBe(true);
		expect((await api.get("/v1/transactions/pending?limit=3")).body.hasMore).toBe(false);
		expect((await api.get("/v1/transactions/pending?limit=201")).status).toBe(400);
	});
});

describe("lançar recorrência", () => {
	it("cria o lançamento do mês e registra; a segunda vez no mês dá 409", async () => {
		const { api, basics } = await setupFinance();
		const { account, card } = await basics();
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
		const posted = await api.post(`/v1/recurrences/${rent.id}/post`, { month: "2026-11" });
		expect(posted.status).toBe(201);
		expect(posted.body.transaction).toMatchObject({
			kind: "expense",
			amountCents: 150000,
			date: "2026-11-05",
			description: "Aluguel",
			accountId: account.id,
		});
		expect(posted.body.posting).toMatchObject({
			recurrenceId: rent.id,
			month: "2026-11",
			transactionId: posted.body.transaction.id,
		});

		const again = await api.post(`/v1/recurrences/${rent.id}/post`, { month: "2026-11" });
		expect(again.status).toBe(409);
		expect(again.body.error.message).toBe("Esta recorrência já foi lançada neste mês.");
		expect((await api.get("/v1/transactions/month/2026-11")).body.transactions).toHaveLength(1);

		// Desfazer: apagar o lançamento libera o mês, e lançar de novo volta a dar 201 (não 409).
		expect((await api.delete(`/v1/transactions/${posted.body.transaction.id}`)).status).toBe(200);
		expect((await api.get("/v1/transactions/month/2026-11")).body.transactions).toHaveLength(0);
		const reposted = await api.post(`/v1/recurrences/${rent.id}/post`, { month: "2026-11" });
		expect(reposted.status).toBe(201);
		expect(reposted.body.transaction.id).not.toBe(posted.body.transaction.id);
		expect((await api.get("/v1/transactions/month/2026-11")).body.transactions).toHaveLength(1);

		// Outro mês, com data e valor próprios.
		const dec = await api.post(`/v1/recurrences/${rent.id}/post`, {
			month: "2026-12",
			date: "2026-12-07",
			amountCents: 151000,
		});
		expect(dec.body.transaction).toMatchObject({ date: "2026-12-07", amountCents: 151000 });

		// No cartão: a fatura vem do engine.
		const netflix = (
			await api.post("/v1/recurrences", {
				kind: "expense",
				name: "Streaming",
				amountCents: 3990,
				dayOfMonth: 15,
				startDate: "2026-01-01",
				cardId: card.id,
			})
		).body.recurrence;
		const onCard = await api.post(`/v1/recurrences/${netflix.id}/post`, { month: "2026-11" });
		expect(onCard.body.transaction).toMatchObject({ cardId: card.id, invoiceMonth: "2026-12" });
	});

	it("valida mês, data fora do mês, sem ocorrência e recorrência arquivada", async () => {
		const { api, basics } = await setupFinance();
		const { account } = await basics();
		const rec = (
			await api.post("/v1/recurrences", {
				kind: "income",
				name: "Salário",
				amountCents: 500000,
				dayOfMonth: 5,
				startDate: "2026-06-01",
				endDate: "2026-09-30",
				accountId: account.id,
			})
		).body.recurrence;
		const path = `/v1/recurrences/${rec.id}/post`;
		expect((await api.post(path, {})).status).toBe(400);
		expect((await api.post(path, { month: "2026-13" })).status).toBe(400);
		expect((await api.post(path, { month: "2026-11" })).status).toBe(400);
		expect((await api.post(path, { month: "2026-08", date: "2026-09-05" })).status).toBe(400);
		expect((await api.post("/v1/recurrences/nao-existe/post", { month: "2026-08" })).status).toBe(404);
		await api.delete(`/v1/recurrences/${rec.id}`);
		expect((await api.post(path, { month: "2026-08" })).status).toBe(400);
	});
});

describe("revisão da fase 4", () => {
	const installmentBody = (cardId: string) => ({
		cardId,
		totalCents: 30000,
		count: 3,
		date: "2026-11-15",
		description: "Notebook",
	});

	it("parcela: não muda data, cartão, valor nem tipo; descrição e categoria sim", async () => {
		const { api, basics } = await setupFinance();
		const { card, category } = await basics();
		const other = (await api.post("/v1/cards", { name: "Outro", closingDay: 1, dueDay: 10 })).body.card;
		const first = (await api.post("/v1/transactions/installments", installmentBody(card.id))).body
			.transactions[0];
		const path = `/v1/transactions/${first.id}`;
		const message = "Para mudar a data, o cartão ou o valor de um parcelamento, apague e lance de novo.";
		for (const patch of [
			{ date: "2026-11-01" },
			{ cardId: other.id },
			{ amountCents: 1 },
			{ kind: "income" },
		]) {
			const res = await api.patch(path, patch);
			expect(res.status, JSON.stringify(patch)).toBe(400);
			expect(res.body.error.message).toBe(message);
		}
		const ok = await api.patch(path, {
			description: "Notebook novo",
			categoryId: category("lazer"),
			note: "x",
			date: first.date,
		});
		expect(ok.status).toBe(200);
		expect(ok.body.transaction).toMatchObject({
			description: "Notebook novo",
			invoiceMonth: first.invoiceMonth,
		});
	});

	it("datas e meses fora de 1900..2199 dão 400, sem estourar o engine", async () => {
		const { api, basics } = await setupFinance();
		const { account, card } = await basics();
		const rec = (
			await api.post("/v1/recurrences", {
				kind: "expense",
				name: "R",
				amountCents: 100,
				dayOfMonth: 5,
				startDate: "2026-01-01",
				accountId: account.id,
			})
		).body.recurrence;
		for (const path of [
			"/v1/summary/0000-01",
			"/v1/summary/2200-01",
			`/v1/cards/${card.id}/invoices/0000-01`,
			"/v1/transactions/month/0000-01",
			"/v1/installments?from=9999-01",
		]) {
			expect((await api.get(path)).status, path).toBe(400);
		}
		expect((await api.post(`/v1/recurrences/${rec.id}/post`, { month: "0000-01" })).status).toBe(400);
		const tx = { kind: "expense", amountCents: 100, date: "9999-12-15", description: "x", cardId: card.id };
		expect((await api.post("/v1/transactions", tx)).status).toBe(400);
		expect((await api.post("/v1/transactions", { ...tx, date: "1899-12-31" })).status).toBe(400);
		expect(
			(await api.post("/v1/transactions/installments", { ...installmentBody(card.id), date: "9999-12-15" }))
				.status,
		).toBe(400);
		expect((await api.post("/v1/transactions", { ...tx, date: "2199-06-15" })).status).toBe(201);
	});

	it("erro do engine que escapa vira 400 genérico", async () => {
		const { app, stores, token } = await setupFinance();
		// Um cartão com dia inválido só existe se o store for burlado: simula o engine lançando RangeError.
		const card = await stores.cards.create({ name: "C", closingDay: 10, dueDay: 20 });
		stores.cards.getConfig = async () => ({ closingDay: 99, dueDay: 20 });
		const res = await app.request("/v1/transactions", {
			method: "POST",
			headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
			body: JSON.stringify({
				kind: "expense",
				amountCents: 100,
				date: "2026-11-15",
				description: "x",
				cardId: card.id,
			}),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string; message: string } };
		expect(body.error.code).toBe("dados_invalidos");
		expect(body.error.message).not.toMatch(/fechamento|99/);
	});

	it("receita não vai no cartão (lançamento e recorrência)", async () => {
		const { api, basics } = await setupFinance();
		const { card } = await basics();
		const income = await api.post("/v1/transactions", {
			kind: "income",
			amountCents: 100,
			date: "2026-11-15",
			description: "Cashback",
			cardId: card.id,
		});
		expect(income.status).toBe(400);
		expect(income.body.error.message).toContain("estorno");
		const rec = await api.post("/v1/recurrences", {
			kind: "income",
			name: "X",
			amountCents: 100,
			dayOfMonth: 5,
			startDate: "2026-01-01",
			cardId: card.id,
		});
		expect(rec.status).toBe(400);
	});

	it("lançar recorrência com data explícita exige ocorrência no mês", async () => {
		const { api, basics } = await setupFinance();
		const { account } = await basics();
		const rec = (
			await api.post("/v1/recurrences", {
				kind: "expense",
				name: "Curso",
				amountCents: 100,
				dayOfMonth: 5,
				startDate: "2026-06-01",
				endDate: "2026-09-30",
				accountId: account.id,
			})
		).body.recurrence;
		// Novembro está depois do fim, mesmo com a data dentro do mês.
		const res = await api.post(`/v1/recurrences/${rec.id}/post`, { month: "2026-11", date: "2026-11-05" });
		expect(res.status).toBe(400);
		expect((await api.get("/v1/transactions/month/2026-11")).body.transactions).toHaveLength(0);
		expect(
			(await api.post(`/v1/recurrences/${rec.id}/post`, { month: "2026-08", date: "2026-08-20" })).status,
		).toBe(201);
	});

	it("dois lançamentos simultâneos da mesma recorrência: um 201, o resto 409, um só lançamento", async () => {
		const { api, basics } = await setupFinance();
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
			Array.from({ length: 5 }, () => api.post(`/v1/recurrences/${rec.id}/post`, { month: "2026-11" })),
		);
		expect(results.filter((r) => r.status === 201)).toHaveLength(1);
		expect(results.filter((r) => r.status === 409)).toHaveLength(4);
		expect((await api.get("/v1/transactions/month/2026-11")).body.transactions).toHaveLength(1);
	});
});
