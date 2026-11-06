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
	const payment = (description = "Aluguel") =>
		stores.transactions.create({
			kind: "expense",
			amountCents: 250_000,
			date: "2026-11-05",
			description,
			accountId: b.checking.id,
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
			const t = await payment();
			await stores.recurrences.recordPosting({
				recurrenceId: rent1.id,
				month: "2026-11",
				transactionId: t.id,
			});
			await stores.recurrences.recordPosting({
				recurrenceId: rent1.id,
				month: "2026-12",
				transactionId: (await payment()).id,
			});
			await stores.recurrences.recordPosting({
				recurrenceId: rent2.id,
				month: "2026-11",
				transactionId: (await payment()).id,
			});
			await expect(
				stores.recurrences.recordPosting({ recurrenceId: rent2.id, month: "2026-12", transactionId: t.id }),
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
});
