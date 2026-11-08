import { pendingInMonth } from "@orbita/core";
import { beforeEach, describe, expect, it } from "vitest";
import { contractSuites, seedBasics } from "./contract-harness.ts";
import { type RecurrenceInput, toMonthlyRecurrence } from "./recurrence-store.ts";
import type { Stores } from "./stores.ts";

describe.each(contractSuites())("RecurrenceStore (%s)", (_name, make) => {
	let stores: Stores;
	let b: Awaited<ReturnType<typeof seedBasics>>;
	beforeEach(async () => {
		stores = await make();
		b = await seedBasics(stores);
	});

	const rent = (extra: Partial<RecurrenceInput> = {}): RecurrenceInput => ({
		kind: "expense",
		name: "Aluguel",
		amountCents: 250_000,
		dayOfMonth: 5,
		startDate: "2026-01-05",
		accountId: b.checking.id,
		...extra,
	});
	const payment = (description = "Aluguel", date = "2026-11-05") =>
		stores.transactions.create({
			kind: "expense",
			amountCents: 250_000,
			date,
			description,
			accountId: b.checking.id,
		});

	it("guarda o lembrete de 1 dia antes: desligado por padrão, liga e desliga por atualização", async () => {
		const r = await stores.recurrences.create(rent());
		expect(r.remindDayBefore).toBe(false);
		const on = await stores.recurrences.create(rent({ name: "Netflix", remindDayBefore: true }));
		expect(on.remindDayBefore).toBe(true);
		expect((await stores.recurrences.get(on.id))?.remindDayBefore).toBe(true);
		// Campo ausente no patch não mexe; `false` desliga.
		expect((await stores.recurrences.update(on.id, { amountCents: 5_000 })).remindDayBefore).toBe(true);
		expect((await stores.recurrences.update(on.id, { remindDayBefore: false })).remindDayBefore).toBe(false);
		expect((await stores.recurrences.update(r.id, { remindDayBefore: true })).remindDayBefore).toBe(true);
	});

	it("cria, lê e lista só as ativas, com datas idênticas", async () => {
		const r = await stores.recurrences.create(
			rent({ startDate: "2024-02-29", endDate: "2026-12-31", categoryId: b.food.id }),
		);
		expect(r).toMatchObject({
			kind: "expense",
			name: "Aluguel",
			dayOfMonth: 5,
			startDate: "2024-02-29",
			endDate: "2026-12-31",
			categoryId: b.food.id,
			cardId: null,
			archivedAt: null,
		});
		expect(await stores.recurrences.get(r.id)).toEqual(r);
		expect((await stores.recurrences.list()).map((x) => x.id)).toEqual([r.id]);
		await stores.recurrences.archive(r.id);
		expect(await stores.recurrences.list()).toEqual([]);
		expect((await stores.recurrences.get(r.id))?.archivedAt).toBeInstanceOf(Date);
	});

	it("atualiza e limpa o fim com null", async () => {
		const r = await stores.recurrences.create(rent({ endDate: "2026-12-31" }));
		const u = await stores.recurrences.update(r.id, { amountCents: 260_000, endDate: null, dayOfMonth: 31 });
		expect(u).toMatchObject({ amountCents: 260_000, endDate: null, dayOfMonth: 31, name: "Aluguel" });
		expect(await stores.recurrences.get(r.id)).toEqual(u);
	});

	it("vira regra do engine (endDate ausente, não null)", async () => {
		const open = await stores.recurrences.create(rent());
		const closed = await stores.recurrences.create(
			rent({ name: "Curso", endDate: "2026-12-05", amountCents: 1000 }),
		);
		expect(toMonthlyRecurrence(open)).toEqual({
			id: open.id,
			kind: "expense",
			amountCents: 250_000,
			dayOfMonth: 5,
			startDate: "2026-01-05",
		});
		expect(toMonthlyRecurrence(closed).endDate).toBe("2026-12-05");
	});

	it.each([
		[{ amountCents: 0 }, "O valor deve ser um inteiro positivo, em centavos."],
		[{ dayOfMonth: 32 }, "O dia do mês deve ser um dia de 1 a 31."],
		[{ startDate: "2026-02-30" }, "A data de início é inválida (use AAAA-MM-DD)."],
		[{ endDate: "2025-12-31" }, "O fim da recorrência não pode ser antes do início."],
		[{ cardId: "qualquer" }, "Informe a conta ou o cartão (apenas um dos dois)."],
		[{ accountId: null }, "Informe a conta ou o cartão (apenas um dos dois)."],
		[{ name: " " }, "Informe o nome da recorrência."],
	] as Array<[Partial<RecurrenceInput>, string]>)("rejeita %j", async (extra, message) => {
		await expect(stores.recurrences.create(rent(extra))).rejects.toMatchObject({ code: "invalid", message });
	});

	it("conta que não existe é bad_reference", async () => {
		await expect(stores.recurrences.create(rent({ accountId: "nada" }))).rejects.toMatchObject({
			code: "bad_reference",
		});
	});

	describe("lançamentos feitos", () => {
		it("registra e lista por mês", async () => {
			const r = await stores.recurrences.create(rent());
			const t = await payment();
			const posting = { recurrenceId: r.id, month: "2026-11", transactionId: t.id };
			expect(await stores.recurrences.recordPosting(posting)).toEqual(posting);
			expect(await stores.recurrences.listPostings("2026-11")).toEqual([posting]);
			expect(await stores.recurrences.listPostings("2026-12")).toEqual([]);
		});

		it("a segunda marcação do mesmo mês é recusada, mesmo com outro lançamento", async () => {
			const r = await stores.recurrences.create(rent());
			await stores.recurrences.recordPosting({
				recurrenceId: r.id,
				month: "2026-11",
				transactionId: (await payment()).id,
			});
			await expect(
				stores.recurrences.recordPosting({
					recurrenceId: r.id,
					month: "2026-11",
					transactionId: (await payment("de novo")).id,
				}),
			).rejects.toMatchObject({ code: "duplicate", message: "Esta recorrência já foi lançada neste mês." });
			expect(await stores.recurrences.listPostings("2026-11")).toHaveLength(1);
		});

		it("outro mês e outra recorrência passam; um lançamento só serve a um mês", async () => {
			const rent1 = await stores.recurrences.create(rent());
			const rent2 = await stores.recurrences.create(rent({ name: "Condomínio" }));
			const rent3 = await stores.recurrences.create(rent({ name: "Internet" }));
			const t = await payment();
			await stores.recurrences.recordPosting({
				recurrenceId: rent1.id,
				month: "2026-11",
				transactionId: t.id,
			});
			await stores.recurrences.recordPosting({
				recurrenceId: rent1.id,
				month: "2026-12",
				transactionId: (await payment("Aluguel", "2026-12-05")).id,
			});
			await stores.recurrences.recordPosting({
				recurrenceId: rent2.id,
				month: "2026-11",
				transactionId: (await payment()).id,
			});
			await expect(
				stores.recurrences.recordPosting({ recurrenceId: rent3.id, month: "2026-11", transactionId: t.id }),
			).rejects.toMatchObject({
				code: "duplicate",
				message: "Este lançamento já está ligado a uma recorrência.",
			});
		});

		it("recusa referência inexistente e mês torto", async () => {
			const r = await stores.recurrences.create(rent());
			const t = await payment();
			await expect(
				stores.recurrences.recordPosting({ recurrenceId: "nada", month: "2026-11", transactionId: t.id }),
			).rejects.toMatchObject({ code: "bad_reference" });
			await expect(
				stores.recurrences.recordPosting({ recurrenceId: r.id, month: "2026-11", transactionId: "nada" }),
			).rejects.toMatchObject({ code: "bad_reference" });
			await expect(
				stores.recurrences.recordPosting({ recurrenceId: r.id, month: "2026-1", transactionId: t.id }),
			).rejects.toMatchObject({ code: "invalid" });
		});

		it("alimenta o engine: o que já foi lançado não é reservado de novo", async () => {
			const r = await stores.recurrences.create(rent());
			const income = await stores.recurrences.create(
				rent({ kind: "income", name: "Salário", amountCents: 800_000, dayOfMonth: 1 }),
			);
			await stores.recurrences.recordPosting({
				recurrenceId: r.id,
				month: "2026-11",
				transactionId: (await payment()).id,
			});
			const rules = (await stores.recurrences.list()).map(toMonthlyRecurrence);
			const pending = pendingInMonth(rules, "2026-11", await stores.recurrences.listPostings("2026-11"));
			expect(pending).toEqual({ expenseCents: 0, incomeCents: 800_000 });
			expect(income.id).toBeTruthy();
		});
	});

	describe("integridade das ligações", () => {
		const post = (recurrenceId: string, month: string, transactionId: string) =>
			stores.recurrences.recordPosting({ recurrenceId, month, transactionId });

		it("apagar o lançamento solta a recorrência para o mês poder ser lançado de novo", async () => {
			const r = await stores.recurrences.create(rent());
			const t = await payment();
			await post(r.id, "2026-11", t.id);
			await stores.transactions.softDelete(t.id);
			expect(await stores.recurrences.listPostings("2026-11")).toEqual([]);
			const again = await payment("Aluguel de novo");
			await post(r.id, "2026-11", again.id);
			expect(await stores.recurrences.listPostings("2026-11")).toHaveLength(1);
		});

		it("apagar o grupo de parcelas solta as ligações das parcelas", async () => {
			const r = await stores.recurrences.create(rent({ name: "Plano 2x" }));
			const rows = await stores.transactions.createInstallmentGroup(
				["2026-11", "2026-12"].map((m, i) => ({
					kind: "expense" as const,
					amountCents: 100,
					date: `${m}-05`,
					description: "Plano",
					accountId: b.checking.id,
					installmentNumber: i + 1,
					installmentCount: 2,
				})),
			);
			await post(r.id, "2026-12", rows[1]?.id ?? "");
			await stores.transactions.softDeleteGroup(rows[0]?.installmentGroupId ?? "");
			expect(await stores.recurrences.listPostings("2026-12")).toEqual([]);
		});

		it("recusa lançamento apagado, tipo diferente e mês de orçamento diferente", async () => {
			const r = await stores.recurrences.create(rent());
			const gone = await payment();
			await stores.transactions.softDelete(gone.id);
			await expect(post(r.id, "2026-11", gone.id)).rejects.toMatchObject({
				code: "invalid",
				message: "Não dá para ligar uma recorrência a um lançamento apagado.",
			});
			const income = await stores.transactions.create({
				kind: "income",
				amountCents: 100,
				date: "2026-11-05",
				description: "Entrada",
				accountId: b.checking.id,
			});
			await expect(post(r.id, "2026-11", income.id)).rejects.toMatchObject({
				code: "invalid",
				message: "O tipo do lançamento (gasto ou receita) não combina com o da recorrência.",
			});
			const december = await payment("Dezembro", "2026-12-05");
			await expect(post(r.id, "2026-11", december.id)).rejects.toMatchObject({
				code: "invalid",
				message: "O mês do orçamento do lançamento não é o mês que a recorrência está cumprindo.",
			});
			expect(await stores.recurrences.listPostings("2026-11")).toEqual([]);
		});

		it("conta, cartão ou categoria arquivada não entra em recorrência nova; a que já usa continua", async () => {
			const old = await stores.accounts.create({ name: "Velha", kind: "savings" });
			const category = await stores.categories.create({ slug: "velha", name: "Velha" });
			const r = await stores.recurrences.create(rent({ accountId: old.id, categoryId: category.id }));
			await stores.accounts.archive(old.id);
			await stores.categories.archive(category.id);
			await expect(stores.recurrences.create(rent({ accountId: old.id }))).rejects.toMatchObject({
				code: "bad_reference",
				message: "A conta informada está arquivada.",
			});
			await expect(stores.recurrences.create(rent({ categoryId: category.id }))).rejects.toMatchObject({
				code: "bad_reference",
				message: "A categoria informada está arquivada.",
			});
			// Editar outra coisa não conta como "mudar a referência".
			expect((await stores.recurrences.update(r.id, { amountCents: 5000 })).amountCents).toBe(5000);
			// Trocar para uma arquivada, sim.
			const other = await stores.recurrences.create(rent());
			await expect(stores.recurrences.update(other.id, { accountId: old.id })).rejects.toMatchObject({
				code: "bad_reference",
			});
			await stores.cards.archive(b.card.id);
			await expect(
				stores.recurrences.update(other.id, { accountId: null, cardId: b.card.id }),
			).rejects.toMatchObject({ code: "bad_reference", message: "O cartão informado está arquivado." });
		});
	});

	describe("postWithTransaction", () => {
		const input = (recurrenceId: string, extra: Record<string, unknown> = {}) => ({
			recurrenceId,
			month: "2026-11",
			transaction: {
				kind: "expense" as const,
				amountCents: 250_000,
				date: "2026-11-05",
				description: "Aluguel",
				accountId: b.checking.id,
				...extra,
			},
		});

		it("cria o lançamento e o posting juntos", async () => {
			const r = await stores.recurrences.create(rent());
			const done = await stores.recurrences.postWithTransaction(input(r.id));
			expect(done.posting).toEqual({
				recurrenceId: r.id,
				month: "2026-11",
				transactionId: done.transaction.id,
			});
			expect(await stores.transactions.get(done.transaction.id)).toEqual(done.transaction);
			expect(await stores.recurrences.listPostings("2026-11")).toEqual([done.posting]);
		});

		it("apagar o lançamento libera o posting e o mês pode ser lançado de novo", async () => {
			const r = await stores.recurrences.create(rent());
			const first = await stores.recurrences.postWithTransaction(input(r.id));
			await stores.transactions.softDelete(first.transaction.id);
			expect(await stores.recurrences.listPostings("2026-11")).toEqual([]);
			const second = await stores.recurrences.postWithTransaction(input(r.id));
			expect(second.transaction.id).not.toBe(first.transaction.id);
			expect(await stores.recurrences.listPostings("2026-11")).toEqual([second.posting]);
		});

		it("segunda vez no mês é duplicate e não deixa lançamento órfão", async () => {
			const r = await stores.recurrences.create(rent());
			await stores.recurrences.postWithTransaction(input(r.id));
			await expect(stores.recurrences.postWithTransaction(input(r.id))).rejects.toMatchObject({
				code: "duplicate",
			});
			expect(await stores.transactions.listByBudgetMonth("2026-11")).toHaveLength(1);
		});

		it("valida tipo, mês e referências sem gravar nada", async () => {
			const r = await stores.recurrences.create(rent());
			await expect(
				stores.recurrences.postWithTransaction(input(r.id, { kind: "income" })),
			).rejects.toMatchObject({ code: "invalid" });
			await expect(
				stores.recurrences.postWithTransaction(input(r.id, { date: "2026-12-05" })),
			).rejects.toMatchObject({ code: "invalid" });
			await expect(stores.recurrences.postWithTransaction(input("nao-existe"))).rejects.toMatchObject({
				code: "bad_reference",
			});
			await stores.accounts.archive(b.checking.id);
			await expect(stores.recurrences.postWithTransaction(input(r.id))).rejects.toMatchObject({
				code: "bad_reference",
			});
			expect(await stores.transactions.listByBudgetMonth("2026-11")).toHaveLength(0);
			expect(await stores.recurrences.listPostings("2026-11")).toHaveLength(0);
		});

		it("dois pedidos ao mesmo tempo: exatamente um lançamento", async () => {
			const r = await stores.recurrences.create(rent());
			const results = await Promise.allSettled(
				Array.from({ length: 6 }, () => stores.recurrences.postWithTransaction(input(r.id))),
			);
			expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
			for (const x of results) {
				if (x.status === "rejected") expect(x.reason).toMatchObject({ code: "duplicate" });
			}
			expect(await stores.transactions.listByBudgetMonth("2026-11")).toHaveLength(1);
			expect(await stores.recurrences.listPostings("2026-11")).toHaveLength(1);
		});
	});
});
