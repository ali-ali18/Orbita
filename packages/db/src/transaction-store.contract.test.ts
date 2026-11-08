import { addMonths, installmentSchedule, invoiceFor, remainingInstallments } from "@orbita/core";
import { beforeEach, describe, expect, it } from "vitest";
import { contractSuites, seedBasics } from "./contract-harness.ts";
import type { Stores } from "./stores.ts";
import {
	type InstallmentInput,
	type TransactionInput,
	toInstallment,
	type UpsertByExternalInput,
} from "./transaction-store.ts";

describe.each(contractSuites())("TransactionStore (%s)", (_name, make) => {
	let stores: Stores;
	let b: Awaited<ReturnType<typeof seedBasics>>;
	let tx: Stores["transactions"];
	beforeEach(async () => {
		stores = await make();
		tx = stores.transactions;
		b = await seedBasics(stores);
	});

	const expense = (extra: Partial<TransactionInput> = {}): TransactionInput => ({
		kind: "expense",
		amountCents: 1990,
		date: "2026-11-05",
		description: "Padaria",
		accountId: b.checking.id,
		...extra,
	});
	const cardPurchase = (extra: Partial<TransactionInput> = {}): TransactionInput =>
		expense({ accountId: null, cardId: b.card.id, invoiceMonth: "2026-11", ...extra });

	describe("gravar e ler", () => {
		it("devolve o que gravou, com os padrões preenchidos", async () => {
			const t = await tx.create(expense({ categoryId: b.food.id, note: "pão" }));
			expect(t).toMatchObject({
				kind: "expense",
				amountCents: 1990,
				date: "2026-11-05",
				description: "Padaria",
				categoryId: b.food.id,
				accountId: b.checking.id,
				cardId: null,
				counterpartAccountId: null,
				refundOfId: null,
				budgetMonth: "2026-11",
				invoiceMonth: null,
				installmentGroupId: null,
				status: "confirmed",
				source: "manual",
				externalId: null,
				note: "pão",
			});
			expect(await tx.get(t.id)).toEqual(t);
		});

		it.each(["2026-02-28", "2024-02-29", "2026-12-31", "2026-01-01", "2026-03-01"])(
			"a data %s volta idêntica (sem andar com o fuso)",
			async (date) => {
				const t = await tx.create(expense({ date }));
				expect(t.date).toBe(date);
				expect((await tx.get(t.id))?.date).toBe(date);
				expect((await tx.listRecent({ limit: 1 }))[0]?.date).toBe(date);
			},
		);

		it("o mês do orçamento padrão é o da data; dá para informar outro", async () => {
			expect((await tx.create(expense({ date: "2026-12-31" }))).budgetMonth).toBe("2026-12");
			expect((await tx.create(expense({ date: "2026-12-31", budgetMonth: "2027-01" }))).budgetMonth).toBe(
				"2027-01",
			);
		});

		it("cria transferência, pagamento de fatura e receita", async () => {
			const transfer = await tx.create({
				kind: "transfer",
				amountCents: 50_000,
				date: "2026-11-01",
				description: "Para a poupança",
				accountId: b.checking.id,
				counterpartAccountId: b.savings.id,
			});
			const payment = await tx.create({
				kind: "card_payment",
				amountCents: 120_000,
				date: "2026-11-17",
				description: "Fatura Nubank",
				accountId: b.checking.id,
				cardId: b.card.id,
			});
			const income = await tx.create({
				...expense(),
				kind: "income",
				description: "Salário",
				amountCents: 500_000,
			});
			expect(transfer.counterpartAccountId).toBe(b.savings.id);
			expect(payment).toMatchObject({ cardId: b.card.id, invoiceMonth: null });
			expect(income.kind).toBe("income");
		});

		it("estorno aponta para a despesa original", async () => {
			const original = await tx.create(cardPurchase({ amountCents: 9000 }));
			const refund = await tx.create({
				...cardPurchase({ amountCents: 4000 }),
				kind: "refund",
				refundOfId: original.id,
			});
			expect(refund.refundOfId).toBe(original.id);
		});
	});

	describe("invariantes (mesma mensagem nas duas implementações)", () => {
		const cases: Array<[string, () => TransactionInput, string]> = [
			["valor zero", () => expense({ amountCents: 0 }), "O valor deve ser um inteiro positivo, em centavos."],
			[
				"valor negativo",
				() => expense({ amountCents: -5 }),
				"O valor deve ser um inteiro positivo, em centavos.",
			],
			[
				"valor fracionário",
				() => expense({ amountCents: 10.5 }),
				"O valor deve ser um inteiro positivo, em centavos.",
			],
			[
				"valor acima do teto do banco",
				() => expense({ amountCents: 2_147_483_648 }),
				"O valor deve ser um inteiro positivo, em centavos.",
			],
			["data inexistente", () => expense({ date: "2026-02-30" }), "Data inválida (use AAAA-MM-DD)."],
			[
				"mês do orçamento torto",
				() => expense({ budgetMonth: "2026-13" }),
				"Mês do orçamento inválido (use AAAA-MM).",
			],
			["descrição vazia", () => expense({ description: "   " }), "Informe a descrição do lançamento."],
			[
				"sem conta nem cartão",
				() => expense({ accountId: null }),
				"Informe a conta ou o cartão (apenas um dos dois).",
			],
			[
				"conta e cartão juntos",
				() => expense({ cardId: b.card.id, invoiceMonth: "2026-11" }),
				"Informe a conta ou o cartão (apenas um dos dois).",
			],
			[
				"cartão sem mês da fatura",
				() => cardPurchase({ invoiceMonth: null }),
				"Compra no cartão precisa do mês da fatura.",
			],
			[
				"conta com mês da fatura",
				() => expense({ invoiceMonth: "2026-11" }),
				"Só compra ou estorno no cartão tem mês de fatura.",
			],
			[
				"destino fora de transferência",
				() => expense({ counterpartAccountId: b.savings.id }),
				"A conta de destino só vale para transferência.",
			],
			[
				"transferência sem conta",
				() => expense({ kind: "transfer", accountId: null }),
				"A transferência precisa de uma conta.",
			],
			[
				"transferência para a mesma conta",
				() => expense({ kind: "transfer", counterpartAccountId: b.checking.id }),
				"Origem e destino da transferência devem ser contas diferentes.",
			],
			[
				"pagamento de fatura sem cartão",
				() => expense({ kind: "card_payment" }),
				"O pagamento de fatura precisa de conta e de cartão.",
			],
			[
				"pagamento de fatura com mês da fatura",
				() => expense({ kind: "card_payment", cardId: b.card.id, invoiceMonth: "2026-11" }),
				"Só compra ou estorno no cartão tem mês de fatura.",
			],
			[
				"estorno sem original",
				() => expense({ kind: "refund" }),
				"O estorno precisa apontar para a despesa original.",
			],
			[
				"despesa com refundOfId",
				() => expense({ refundOfId: "x" }),
				"Só estorno aponta para uma despesa original.",
			],
		];
		it.each(cases)("%s", async (_label, input, message) => {
			await expect(tx.create(input())).rejects.toMatchObject({ name: "DataError", code: "invalid", message });
			expect(await tx.listRecent({ limit: 10 })).toEqual([]);
		});

		it("estorno de despesa inexistente, apagada ou de receita é recusado", async () => {
			const refund = (refundOfId: string) =>
				tx.create({ ...expense({ amountCents: 100 }), kind: "refund", refundOfId });
			const message = "O estorno deve apontar para uma despesa que existe.";
			await expect(refund("nada")).rejects.toMatchObject({ code: "bad_reference", message });
			const gone = await tx.create(expense());
			await tx.softDelete(gone.id);
			await expect(refund(gone.id)).rejects.toMatchObject({ code: "bad_reference", message });
			const income = await tx.create({ ...expense(), kind: "income" });
			await expect(refund(income.id)).rejects.toMatchObject({ code: "bad_reference", message });
		});

		it("conta, cartão ou categoria que não existe é bad_reference", async () => {
			const message = "Conta, cartão, categoria ou lançamento informado não existe.";
			await expect(tx.create(expense({ accountId: "nada" }))).rejects.toMatchObject({
				code: "bad_reference",
				message,
			});
			await expect(tx.create(cardPurchase({ cardId: "nada" }))).rejects.toMatchObject({
				code: "bad_reference",
				message,
			});
			await expect(tx.create(expense({ categoryId: "nada" }))).rejects.toMatchObject({
				code: "bad_reference",
				message,
			});
			expect(await tx.listRecent({ limit: 10 })).toEqual([]);
		});
	});

	describe("update", () => {
		it("troca campos, limpa com null e revalida o lançamento inteiro", async () => {
			const t = await tx.create(expense({ categoryId: b.food.id }));
			const u = await tx.update(t.id, {
				description: "Mercado",
				categoryId: null,
				amountCents: 2500,
				note: "x",
			});
			expect(u).toMatchObject({
				description: "Mercado",
				categoryId: null,
				amountCents: 2500,
				note: "x",
				accountId: b.checking.id,
			});
			expect(u.updatedAt.getTime()).toBeGreaterThan(t.updatedAt.getTime());
			expect(await tx.get(t.id)).toEqual(u);
		});

		it("transferência sem destino conhecido é válida (outra conta sua, não identificada)", async () => {
			const t = await tx.create(expense({ kind: "transfer" }));
			expect(t).toMatchObject({ kind: "transfer", counterpartAccountId: null });
			const e = await tx.create(expense());
			const u = await tx.update(e.id, { kind: "transfer", counterpartAccountId: b.savings.id });
			expect(u).toMatchObject({ kind: "transfer", counterpartAccountId: b.savings.id });
			expect(await tx.update(e.id, { counterpartAccountId: null })).toMatchObject({
				counterpartAccountId: null,
			});
		});

		it("recusa patch que deixa o lançamento inválido e não grava nada", async () => {
			const t = await tx.create(expense());
			await expect(
				tx.update(t.id, { kind: "transfer", counterpartAccountId: t.accountId }),
			).rejects.toMatchObject({
				code: "invalid",
				message: "Origem e destino da transferência devem ser contas diferentes.",
			});
			await expect(tx.update(t.id, { accountId: null })).rejects.toMatchObject({ code: "invalid" });
			await expect(tx.update(t.id, { cardId: b.card.id })).rejects.toMatchObject({ code: "invalid" });
			expect(await tx.get(t.id)).toEqual(t);
		});

		it("not_found para lançamento que não existe ou foi apagado", async () => {
			const t = await tx.create(expense());
			await tx.softDelete(t.id);
			await expect(tx.update(t.id, { note: "x" })).rejects.toMatchObject({
				code: "not_found",
				message: "Lançamento não encontrado.",
			});
			await expect(tx.update("nada", { note: "x" })).rejects.toMatchObject({ code: "not_found" });
		});

		it("confirma um pendente", async () => {
			const t = await tx.create(expense({ status: "pending", source: "notification", externalId: "n1" }));
			expect(await tx.listPending()).toHaveLength(1);
			await tx.update(t.id, { status: "confirmed" });
			expect(await tx.listPending()).toEqual([]);
		});
	});

	describe("parcelamento", () => {
		const group = (count = 3, extra: Partial<InstallmentInput> = {}): InstallmentInput[] =>
			Array.from({ length: count }, (_, i) => ({
				...cardPurchase({ amountCents: 3334 - (i === 0 ? 0 : 1), description: "TV 3x" }),
				invoiceMonth: addMonths("2026-11", i),
				budgetMonth: addMonths("2026-11", i),
				installmentNumber: i + 1,
				installmentCount: count,
				...extra,
			}));

		it("grava todas com o mesmo grupo", async () => {
			const rows = await tx.createInstallmentGroup(group());
			expect(rows).toHaveLength(3);
			expect(new Set(rows.map((r) => r.installmentGroupId)).size).toBe(1);
			expect(rows[0]?.installmentGroupId).toBeTruthy();
			expect(rows.map((r) => r.installmentNumber)).toEqual([1, 2, 3]);
			expect(rows.map((r) => r.invoiceMonth)).toEqual(["2026-11", "2026-12", "2027-01"]);
		});

		it("um item inválido: nada é gravado", async () => {
			const inputs = group();
			inputs[2] = { ...(inputs[2] as InstallmentInput), amountCents: 0 };
			await expect(tx.createInstallmentGroup(inputs)).rejects.toMatchObject({ code: "invalid" });
			expect(await tx.listRecent({ limit: 10 })).toEqual([]);
		});

		it("um item com cartão que não existe: nada é gravado", async () => {
			const inputs = group();
			inputs[2] = { ...(inputs[2] as InstallmentInput), cardId: "nada" };
			await expect(tx.createInstallmentGroup(inputs)).rejects.toMatchObject({ code: "bad_reference" });
			expect(await tx.listRecent({ limit: 10 })).toEqual([]);
		});

		it("id externo repetido dentro do grupo: nada é gravado", async () => {
			const inputs = group(2, { source: "import", externalId: "mesmo" });
			await expect(tx.createInstallmentGroup(inputs)).rejects.toMatchObject({ code: "duplicate" });
			expect(await tx.listRecent({ limit: 10 })).toEqual([]);
		});

		it("id externo que já existe no banco derruba o grupo inteiro", async () => {
			await tx.create(expense({ source: "import", externalId: "ja-existe" }));
			const inputs = group(3);
			inputs[1] = { ...(inputs[1] as InstallmentInput), source: "import", externalId: "ja-existe" };
			await expect(tx.createInstallmentGroup(inputs)).rejects.toMatchObject({ code: "duplicate" });
			expect(await tx.listRecent({ limit: 10 })).toHaveLength(1);
		});

		it("rejeita grupo vazio, totais diferentes e números repetidos", async () => {
			await expect(tx.createInstallmentGroup([])).rejects.toMatchObject({
				code: "invalid",
				message: "O parcelamento precisa de pelo menos uma parcela.",
			});
			const mixed = group(2);
			mixed[1] = { ...(mixed[1] as InstallmentInput), installmentCount: 4 };
			await expect(tx.createInstallmentGroup(mixed)).rejects.toMatchObject({
				message: "Todas as parcelas devem ter o mesmo total de parcelas.",
			});
			const repeated = group(2);
			repeated[1] = { ...(repeated[1] as InstallmentInput), installmentNumber: 1 };
			await expect(tx.createInstallmentGroup(repeated)).rejects.toMatchObject({
				message: "Há duas parcelas com o mesmo número.",
			});
			expect(await tx.listRecent({ limit: 10 })).toEqual([]);
		});

		it("softDeleteGroup apaga todas as parcelas e devolve quantas", async () => {
			const rows = await tx.createInstallmentGroup(group());
			const other = await tx.create(expense());
			expect(await tx.softDeleteGroup(rows[0]?.installmentGroupId ?? "")).toBe(3);
			expect(await tx.softDeleteGroup(rows[0]?.installmentGroupId ?? "")).toBe(0);
			expect((await tx.listRecent({ limit: 10 })).map((t) => t.id)).toEqual([other.id]);
		});

		it("integra com o engine: compra parcelada, fatura e o que falta", async () => {
			const config = await stores.cards.getConfig(b.card.id);
			if (!config) throw new Error("cartão sumiu");
			const schedule = installmentSchedule({
				purchaseDate: "2026-11-12",
				totalCents: 100_000,
				count: 4,
				card: config,
			});
			const rows = await tx.createInstallmentGroup(
				schedule.map((p) => ({
					kind: "expense" as const,
					amountCents: p.amountCents,
					date: "2026-11-12",
					description: "Geladeira 4x",
					cardId: b.card.id,
					invoiceMonth: p.invoiceMonth,
					budgetMonth: p.budgetMonth,
					installmentNumber: p.number,
					installmentCount: p.count,
				})),
			);
			// Fecha dia 10: a compra do dia 12 cai na fatura que vence em dezembro.
			expect(invoiceFor("2026-11-12", config).month).toBe("2026-12");
			expect(rows.map((r) => r.invoiceMonth)).toEqual(["2026-12", "2027-01", "2027-02", "2027-03"]);
			expect(rows.map((r) => r.budgetMonth)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
			const [g] = await tx.listInstallmentGroups("2026-12");
			const progress = remainingInstallments((g?.installments ?? []).map(toInstallment), "2027-02");
			expect(progress).toEqual({
				paidCents: 50_000,
				remainingCents: 50_000,
				paidCount: 2,
				remainingCount: 2,
			});
		});
	});

	describe("ingestão idempotente", () => {
		const incoming = (extra: Partial<UpsertByExternalInput> = {}): UpsertByExternalInput => ({
			kind: "expense",
			amountCents: 1990,
			date: "2026-11-05",
			description: "Padaria",
			accountId: b.checking.id,
			status: "pending",
			...extra,
		});

		it("guarda a categoria do banco e o nome do estabelecimento, saneados e limitados", async () => {
			const created = await tx.upsertByExternal(
				"pluggy",
				"cat-1",
				incoming({ sourceCategory: "  Transfer \u0000- PIX  ", merchantName: "x".repeat(300) }),
			);
			expect(created.transaction?.sourceCategory).toBe("Transfer - PIX");
			expect(created.transaction?.merchantName).toHaveLength(120);
			expect(created.transaction?.categoryEditedByOwner).toBe(false);
			const plain = await tx.upsertByExternal("pluggy", "cat-2", incoming({ sourceCategory: "   " }));
			expect(plain.transaction?.sourceCategory).toBeNull();
			expect(plain.transaction?.merchantName).toBeNull();
			// Informativos: o PATCH não altera.
			await expect(
				tx.update(created.transaction?.id ?? "", { sourceCategory: "Outra" } as never),
			).rejects.toMatchObject({ code: "invalid" });
		});

		it("categoryEditedByOwner só liga pelo update e listCategoryNotEditedByOwner ignora esses", async () => {
			const a = await tx.upsertByExternal("pluggy", "ed-1", incoming());
			const b2 = await tx.upsertByExternal("pluggy", "ed-2", incoming());
			await tx.update(a.transaction?.id ?? "", { categoryEditedByOwner: true, categoryId: b.food.id });
			const open = await tx.listCategoryNotEditedByOwner();
			expect(open.map((t) => t.id)).toEqual([b2.transaction?.id]);
			expect((await tx.get(a.transaction?.id ?? ""))?.categoryEditedByOwner).toBe(true);
		});

		describe("upsertInstallmentByExternal", () => {
			const parcel = (number: number) =>
				tx.upsertInstallmentByExternal(
					"pluggy",
					`p-${number}`,
					incoming({
						accountId: null,
						cardId: b.card.id,
						invoiceMonth: `2026-${String(10 + number).padStart(2, "0")}`,
					}),
					{ groupId: "pluggy-g1", number, count: 10 },
				);

			it("o grupo cresce parcela a parcela e aparece em listInstallmentGroups", async () => {
				const first = await parcel(1);
				expect(first.created).toBe(true);
				expect(first.transaction).toMatchObject({
					installmentGroupId: "pluggy-g1",
					installmentNumber: 1,
					installmentCount: 10,
				});
				await parcel(2);
				const groups = await tx.listInstallmentGroups("2026-01");
				expect(groups).toHaveLength(1);
				expect(groups[0]?.installments.map((t) => t.installmentNumber)).toEqual([1, 2]);
			});

			it("repetir é idempotente e o apagado não volta", async () => {
				const first = await parcel(1);
				const again = await parcel(1);
				expect(again.created).toBe(false);
				expect(again.transaction).toEqual(first.transaction);
				await tx.softDelete(first.transaction?.id ?? "");
				expect(await parcel(1)).toEqual({ created: false, transaction: null });
			});

			it("outra compra no mesmo grupo e número é duplicate", async () => {
				await parcel(1);
				await expect(
					tx.upsertInstallmentByExternal(
						"pluggy",
						"outra",
						incoming({ accountId: null, cardId: b.card.id, invoiceMonth: "2026-11" }),
						{ groupId: "pluggy-g1", number: 1, count: 10 },
					),
				).rejects.toMatchObject({ code: "duplicate" });
			});

			it("valida número e total", async () => {
				await expect(
					tx.upsertInstallmentByExternal(
						"pluggy",
						"ruim",
						incoming({ accountId: null, cardId: b.card.id, invoiceMonth: "2026-11" }),
						{ groupId: "g", number: 11, count: 10 },
					),
				).rejects.toMatchObject({ code: "invalid" });
			});
		});

		it("a mesma origem + id devolve o lançamento existente", async () => {
			const first = await tx.upsertByExternal("pluggy", "abc-1", incoming());
			expect(first.created).toBe(true);
			const again = await tx.upsertByExternal(
				"pluggy",
				"abc-1",
				incoming({ amountCents: 999, description: "Outro texto" }),
			);
			expect(again.created).toBe(false);
			expect(again.transaction).toEqual(first.transaction);
			expect(await tx.listRecent({ limit: 10 })).toHaveLength(1);
		});

		it("repetir a chamada várias vezes cria uma só (a corrida de verdade está em concurrency.test.ts)", async () => {
			const results = [];
			for (let i = 0; i < 4; i++) results.push(await tx.upsertByExternal("pluggy", "repetida", incoming()));
			expect(results.filter((r) => r.created)).toHaveLength(1);
			expect(new Set(results.map((r) => r.transaction?.id)).size).toBe(1);
			expect(await tx.listRecent({ limit: 10 })).toHaveLength(1);
		});

		it("origens diferentes com o mesmo id são lançamentos diferentes", async () => {
			await tx.upsertByExternal("pluggy", "1", incoming());
			const other = await tx.upsertByExternal("notification", "1", incoming());
			expect(other.created).toBe(true);
			expect(await tx.listRecent({ limit: 10 })).toHaveLength(2);
		});

		it("o lançamento apagado pelo usuário não ressuscita", async () => {
			const first = await tx.upsertByExternal("pluggy", "abc-2", incoming());
			await tx.softDelete(first.transaction?.id ?? "");
			const again = await tx.upsertByExternal("pluggy", "abc-2", incoming());
			expect(again).toEqual({ created: false, transaction: null });
			expect(await tx.listRecent({ limit: 10 })).toEqual([]);
		});

		it("existsByExternal enxerga o vivo e o apagado, por origem", async () => {
			expect(await tx.existsByExternal("pluggy", "e-1")).toBe(false);
			const first = await tx.upsertByExternal("pluggy", "e-1", incoming());
			expect(await tx.existsByExternal("pluggy", "e-1")).toBe(true);
			expect(await tx.existsByExternal("notification", "e-1")).toBe(false);
			await tx.softDelete(first.transaction?.id ?? "");
			expect(await tx.existsByExternal("pluggy", "e-1")).toBe(true);
		});

		it("findByExternal devolve só o vivo, por origem", async () => {
			expect(await tx.findByExternal("pluggy", "f-1")).toBeNull();
			const first = await tx.upsertByExternal("pluggy", "f-1", incoming());
			expect((await tx.findByExternal("pluggy", "f-1"))?.id).toBe(first.transaction?.id);
			expect(await tx.findByExternal("notification", "f-1")).toBeNull();
			await tx.softDelete(first.transaction?.id ?? "");
			expect(await tx.findByExternal("pluggy", "f-1")).toBeNull();
		});

		it("hardDeleteBySource apaga só a origem pedida, de verdade, com estornos e ligações", async () => {
			const manual = await tx.create(expense({ description: "Manual" }));
			const bought = await tx.upsertByExternal(
				"pluggy",
				"compra",
				incoming({ accountId: null, cardId: b.card.id, invoiceMonth: "2026-11" }),
			);
			const boughtId = bought.transaction?.id ?? "";
			const refund = await tx.upsertByExternal("pluggy", "estorno", {
				...incoming({ accountId: null, cardId: b.card.id, invoiceMonth: "2026-11" }),
				kind: "refund",
				refundOfId: boughtId,
			});
			// Estorno manual de uma compra do Pluggy: sai junto (não vive sem a compra).
			const manualRefund = await tx.create({
				...cardPurchase(),
				kind: "refund",
				refundOfId: boughtId,
			});
			const apagado = await tx.upsertByExternal("pluggy", "apagado", incoming());
			await tx.softDelete(apagado.transaction?.id ?? "");
			const other = await tx.upsertByExternal("notification", "n1", incoming());
			const rule = await stores.recurrences.create({
				kind: "expense",
				name: "Aluguel",
				amountCents: 1990,
				dayOfMonth: 5,
				startDate: "2026-01-01",
				accountId: b.checking.id,
			});
			await stores.recurrences.postWithTransaction({
				recurrenceId: rule.id,
				month: "2026-11",
				transaction: expense({ description: "Aluguel", budgetMonth: "2026-11" }),
			});

			expect(await tx.hardDeleteBySource("pluggy")).toBe(4);

			expect(await tx.get(boughtId)).toBeNull();
			expect(await tx.get(refund.transaction?.id ?? "")).toBeNull();
			expect(await tx.get(manualRefund.id)).toBeNull();
			expect(await tx.get(manual.id)).not.toBeNull();
			expect(await tx.get(other.transaction?.id ?? "")).not.toBeNull();
			// De verdade: o identificador fica livre, inclusive o do que o dono tinha apagado.
			expect(await tx.existsByExternal("pluggy", "compra")).toBe(false);
			expect(await tx.existsByExternal("pluggy", "apagado")).toBe(false);
			expect((await tx.upsertByExternal("pluggy", "apagado", incoming())).created).toBe(true);
			// A recorrência e o lançamento dela continuam.
			expect(await stores.recurrences.get(rule.id)).not.toBeNull();
			expect(await stores.recurrences.listPostings("2026-11")).toHaveLength(1);
			expect(await tx.hardDeleteBySource("pluggy")).toBe(1);
			expect(await tx.hardDeleteBySource("pluggy")).toBe(0);
		});

		it("hardDeleteBySource solta a ligação com recorrência de um lançamento da origem", async () => {
			const rule = await stores.recurrences.create({
				kind: "expense",
				name: "Aluguel",
				amountCents: 1990,
				dayOfMonth: 5,
				startDate: "2026-01-01",
				accountId: b.checking.id,
			});
			const posted = await stores.recurrences.postWithTransaction({
				recurrenceId: rule.id,
				month: "2026-11",
				transaction: expense({
					description: "Aluguel",
					budgetMonth: "2026-11",
					source: "pluggy",
					externalId: "r1",
				}),
			});
			expect(await tx.hardDeleteBySource("pluggy")).toBe(1);
			expect(await tx.get(posted.transaction.id)).toBeNull();
			expect(await stores.recurrences.listPostings("2026-11")).toEqual([]);
		});

		it("hardDeleteBySource recusa a origem manual", async () => {
			await tx.create(expense());
			await expect(tx.hardDeleteBySource("manual")).rejects.toMatchObject({ code: "invalid" });
			expect(await tx.listRecent({ limit: 10 })).toHaveLength(1);
		});

		it("valida mesmo quando já existe, e o id externo não pode ser vazio", async () => {
			await tx.upsertByExternal("pluggy", "abc-3", incoming());
			await expect(
				tx.upsertByExternal("pluggy", "abc-3", incoming({ amountCents: 0 })),
			).rejects.toMatchObject({ code: "invalid" });
			await expect(tx.upsertByExternal("pluggy", "  ", incoming())).rejects.toMatchObject({
				code: "invalid",
				message: "O identificador externo deve ter de 1 a 200 letras.",
			});
		});

		it("create com (origem, id) repetido é duplicate", async () => {
			await tx.create(expense({ source: "import", externalId: "e1" }));
			await expect(tx.create(expense({ source: "import", externalId: "e1" }))).rejects.toMatchObject({
				code: "duplicate",
				message: "Já existe um lançamento desta origem com o mesmo identificador externo.",
			});
			// Sem id externo, nada impede dois iguais.
			await tx.create(expense());
			await tx.create(expense());
		});
	});

	describe("exclusão lógica", () => {
		it("some de get e de todas as listas, e softDelete é idempotente", async () => {
			const t = await tx.create(cardPurchase({ status: "pending" }));
			const keep = await tx.create(cardPurchase({ description: "Fica" }));
			expect(await tx.softDelete(t.id)).toBe(true);
			expect(await tx.softDelete(t.id)).toBe(false);
			expect(await tx.softDelete("nada")).toBe(false);
			expect(await tx.get(t.id)).toBeNull();
			expect((await tx.listByBudgetMonth("2026-11")).map((x) => x.id)).toEqual([keep.id]);
			expect((await tx.listByInvoice(b.card.id, "2026-11")).map((x) => x.id)).toEqual([keep.id]);
			expect(await tx.listPending()).toEqual([]);
			expect((await tx.listRecent({ limit: 10 })).map((x) => x.id)).toEqual([keep.id]);
		});

		it("parcela apagada some do grupo, e grupo sem parcelas ativas some", async () => {
			const rows = await tx.createInstallmentGroup(
				[1, 2].map((n) => ({
					...cardPurchase({ invoiceMonth: `2026-${10 + n}` }),
					installmentNumber: n,
					installmentCount: 2,
				})),
			);
			await tx.softDelete(rows[1]?.id ?? "");
			const [g] = await tx.listInstallmentGroups("2026-01");
			expect(g?.installments.map((i) => i.installmentNumber)).toEqual([1]);
			await tx.softDelete(rows[0]?.id ?? "");
			expect(await tx.listInstallmentGroups("2026-01")).toEqual([]);
		});
	});

	describe("listas", () => {
		it("listByBudgetMonth filtra pelo mês do orçamento, não pela data, e ordena por data", async () => {
			const late = await tx.create(expense({ date: "2026-11-20" }));
			const early = await tx.create(expense({ date: "2026-11-02" }));
			await tx.create(expense({ date: "2026-10-30" }));
			const shifted = await tx.create(expense({ date: "2026-10-30", budgetMonth: "2026-11" }));
			expect((await tx.listByBudgetMonth("2026-11")).map((t) => t.id)).toEqual([
				shifted.id,
				early.id,
				late.id,
			]);
			expect(await tx.listByBudgetMonth("2027-05")).toEqual([]);
			await expect(tx.listByBudgetMonth("2026-1")).rejects.toMatchObject({ code: "invalid" });
		});

		it("aplicação (investment) só vale em conta, nunca no cartão", async () => {
			const ok = await tx.create({ ...expense(), kind: "investment" });
			expect(ok.kind).toBe("investment");
			await expect(tx.create({ ...cardPurchase(), kind: "investment" })).rejects.toMatchObject({
				code: "invalid",
			});
		});

		it("listBudgetMonths devolve os meses com lançamento vivo, do mais recente ao mais antigo", async () => {
			expect(await tx.listBudgetMonths()).toEqual([]);
			await tx.create(expense({ date: "2026-09-02" }));
			await tx.create(expense({ date: "2026-11-20" }));
			const gone = await tx.create(expense({ date: "2026-12-01" }));
			await tx.create(expense({ date: "2026-11-02" }));
			await tx.create(expense({ date: "2026-10-30", budgetMonth: "2026-11" }));
			await tx.softDelete(gone.id);
			expect(await tx.listBudgetMonths()).toEqual(["2026-11", "2026-09"]);
			// Compra no cartão vale pelo mês da compra (competência), não pelo da fatura.
			await tx.create(cardPurchase({ date: "2026-11-25", invoiceMonth: "2026-12" }));
			expect(await tx.listBudgetMonths()).toEqual(["2026-11", "2026-09"]);
		});

		it("listByInvoice filtra por cartão e fatura", async () => {
			const other = await stores.cards.create({ name: "Inter", closingDay: 1, dueDay: 8 });
			const a = await tx.create(cardPurchase({ date: "2026-11-03" }));
			const a2 = await tx.create(cardPurchase({ date: "2026-10-25" }));
			await tx.create(cardPurchase({ invoiceMonth: "2026-12" }));
			await tx.create(cardPurchase({ cardId: other.id }));
			await tx.create(expense());
			expect((await tx.listByInvoice(b.card.id, "2026-11")).map((t) => t.id)).toEqual([a2.id, a.id]);
			expect(await tx.listByInvoice(other.id, "2026-12")).toEqual([]);
		});

		it("listCardPayments traz só pagamentos do cartão na janela (bordas inclusas), sem apagados", async () => {
			const other = await stores.cards.create({ name: "Inter", closingDay: 1, dueDay: 8 });
			const pay = (extra: Partial<TransactionInput> = {}) =>
				tx.create({
					kind: "card_payment",
					amountCents: 10_000,
					date: "2026-11-05",
					description: "Fatura",
					accountId: b.checking.id,
					cardId: b.card.id,
					...extra,
				});
			const edgeFrom = await pay({ date: "2026-10-25" });
			const mid = await pay({ date: "2026-11-05", amountCents: 20_000 });
			const edgeTo = await pay({ date: "2026-11-24" });
			await pay({ date: "2026-10-24" });
			await pay({ date: "2026-11-25" });
			await pay({ cardId: other.id });
			const gone = await pay({ date: "2026-11-06" });
			await tx.softDelete(gone.id);
			await tx.create(cardPurchase({ date: "2026-11-05" }));
			const found = await tx.listCardPayments(b.card.id, { from: "2026-10-25", to: "2026-11-24" });
			expect(found.map((t) => t.id)).toEqual([edgeFrom.id, mid.id, edgeTo.id]);
		});

		it("listByTarget traz os vivos da conta ou do cartão no intervalo, de qualquer origem", async () => {
			const inside = await tx.create(expense({ date: "2026-11-05", source: "import", externalId: "i1" }));
			const edge = await tx.create(expense({ date: "2026-11-10", status: "pending" }));
			await tx.create(expense({ date: "2026-11-11" }));
			await tx.create(expense({ date: "2026-11-04", amountCents: 5 }));
			await tx.create(expense({ date: "2026-11-06", accountId: b.savings.id }));
			const card = await tx.create(cardPurchase({ date: "2026-11-06" }));
			const gone = await tx.create(expense({ date: "2026-11-07" }));
			await tx.softDelete(gone.id);
			const range = { from: "2026-11-05", to: "2026-11-10" };
			expect((await tx.listByTarget({ accountId: b.checking.id }, range)).map((t) => t.id)).toEqual([
				inside.id,
				edge.id,
			]);
			expect((await tx.listByTarget({ cardId: b.card.id }, range)).map((t) => t.id)).toEqual([card.id]);
		});

		it("listByTarget exige conta ou cartão, um só", async () => {
			const range = { from: "2026-11-05", to: "2026-11-10" };
			await expect(tx.listByTarget({}, range)).rejects.toMatchObject({ code: "invalid" });
			await expect(
				tx.listByTarget({ accountId: b.checking.id, cardId: b.card.id }, range),
			).rejects.toMatchObject({ code: "invalid" });
		});

		it("listPending só traz os pendentes, do mais recente ao mais antigo", async () => {
			const old = await tx.create(expense({ status: "pending", date: "2026-11-01" }));
			const recent = await tx.create(expense({ status: "pending", date: "2026-11-09" }));
			await tx.create(expense({ date: "2026-11-10" }));
			expect((await tx.listPending()).map((t) => t.id)).toEqual([recent.id, old.id]);
		});

		it("listRecent pagina por cursor (data + id) sem repetir nem pular, inclusive no mesmo dia", async () => {
			const dates = [
				"2026-11-01",
				"2026-11-03",
				"2026-11-03",
				"2026-11-03",
				"2026-11-04",
				"2026-10-31",
				"2026-11-03",
			];
			const created = [];
			for (const date of dates) created.push(await tx.create(expense({ date })));
			const seen: string[] = [];
			let before: { date: string; id: string } | undefined;
			for (let page = 0; page < 10; page++) {
				const rows = await tx.listRecent(before ? { limit: 3, before } : { limit: 3 });
				if (rows.length === 0) break;
				seen.push(...rows.map((r) => r.id));
				const last = rows.at(-1);
				if (!last) break;
				before = { date: last.date, id: last.id };
			}
			expect(seen).toHaveLength(created.length);
			expect(new Set(seen).size).toBe(created.length);
			const all = await tx.listRecent({ limit: 100 });
			expect(seen).toEqual(all.map((r) => r.id));
			// Ordem esperada montada à parte: data e id, do maior para o menor.
			const expected = [...created]
				.sort((x, y) => (x.date === y.date ? (x.id < y.id ? 1 : -1) : x.date < y.date ? 1 : -1))
				.map((r) => r.id);
			expect(seen).toEqual(expected);
		});

		it("listRecent valida o limite e o cursor", async () => {
			await expect(tx.listRecent({ limit: 0 })).rejects.toMatchObject({ code: "invalid" });
			await expect(tx.listRecent({ limit: 501 })).rejects.toMatchObject({ code: "invalid" });
			await expect(tx.listRecent({ limit: 5, before: { date: "ontem", id: "x" } })).rejects.toMatchObject({
				code: "invalid",
			});
		});

		describe("listRecent com filtro", () => {
			const ids = async (filter: Parameters<typeof tx.listRecent>[0]["filter"]) =>
				(await tx.listRecent({ limit: 100, filter })).map((t) => t.id);

			it("sem filtro ou com filtro vazio devolve tudo", async () => {
				const a = await tx.create(expense());
				const b2 = await tx.create(expense({ date: "2026-11-06" }));
				expect(await ids({})).toEqual([b2.id, a.id]);
				expect(await ids({ kinds: [], accountIds: [] })).toEqual([b2.id, a.id]);
			});

			it("tipo, origem e situação (OU dentro da lista, E entre filtros)", async () => {
				const exp = await tx.create(expense({ date: "2026-11-01" }));
				const inc = await tx.create({ ...expense({ date: "2026-11-02" }), kind: "income" });
				const tr = await tx.create({
					...expense({ date: "2026-11-03" }),
					kind: "transfer",
					counterpartAccountId: b.savings.id,
				});
				const pend = await tx.create(
					expense({ date: "2026-11-04", status: "pending", source: "notification" }),
				);
				expect(await ids({ kinds: ["income", "transfer"] })).toEqual([tr.id, inc.id]);
				expect(await ids({ sources: ["notification"] })).toEqual([pend.id]);
				expect(await ids({ statuses: ["pending"] })).toEqual([pend.id]);
				expect(await ids({ statuses: ["confirmed"], kinds: ["expense"] })).toEqual([exp.id]);
				expect(await ids({ statuses: ["pending"], kinds: ["income"] })).toEqual([]);
			});

			it("período inclusivo nas duas pontas", async () => {
				const first = await tx.create(expense({ date: "2026-10-31" }));
				const mid = await tx.create(expense({ date: "2026-11-15" }));
				const last = await tx.create(expense({ date: "2026-11-30" }));
				await tx.create(expense({ date: "2026-12-01" }));
				expect(await ids({ from: "2026-10-31", to: "2026-11-30" })).toEqual([last.id, mid.id, first.id]);
				expect(await ids({ from: "2026-11-01" })).toContain(last.id);
				expect(await ids({ from: "2026-11-01", to: "2026-11-30" })).toEqual([last.id, mid.id]);
				expect(await ids({ to: "2026-10-31" })).toEqual([first.id]);
			});

			it("faixa de valor em centavos, inclusiva", async () => {
				const low = await tx.create(expense({ amountCents: 1000, date: "2026-11-01" }));
				const mid = await tx.create(expense({ amountCents: 5000, date: "2026-11-02" }));
				const high = await tx.create(expense({ amountCents: 9000, date: "2026-11-03" }));
				expect(await ids({ minCents: 5000 })).toEqual([high.id, mid.id]);
				expect(await ids({ maxCents: 5000 })).toEqual([mid.id, low.id]);
				expect(await ids({ minCents: 1000, maxCents: 9000 })).toHaveLength(3);
				expect(await ids({ minCents: 5000, maxCents: 5000 })).toEqual([mid.id]);
			});

			it("contas e cartões valem como OU; a conta casa também com o destino da transferência", async () => {
				const inChecking = await tx.create(expense({ date: "2026-11-01" }));
				const inCard = await tx.create(cardPurchase({ date: "2026-11-02" }));
				const toSavings = await tx.create({
					...expense({ date: "2026-11-03" }),
					kind: "transfer",
					counterpartAccountId: b.savings.id,
				});
				expect(await ids({ accountIds: [b.checking.id] })).toEqual([toSavings.id, inChecking.id]);
				expect(await ids({ accountIds: [b.savings.id] })).toEqual([toSavings.id]);
				expect(await ids({ cardIds: [b.card.id] })).toEqual([inCard.id]);
				expect(await ids({ accountIds: [b.savings.id], cardIds: [b.card.id] })).toEqual([
					toSavings.id,
					inCard.id,
				]);
				expect(await ids({ accountIds: ["nao-existe"] })).toEqual([]);
			});

			it("categorias; lançamento sem categoria não passa quando há filtro de categoria", async () => {
				const other = await stores.categories.create({ slug: "lazer", name: "Lazer", chartSlot: 1 });
				const food = await tx.create(expense({ categoryId: b.food.id, date: "2026-11-01" }));
				const fun = await tx.create(expense({ categoryId: other.id, date: "2026-11-02" }));
				await tx.create(expense({ date: "2026-11-03" }));
				expect(await ids({ categoryIds: [b.food.id] })).toEqual([food.id]);
				expect(await ids({ categoryIds: [b.food.id, other.id] })).toEqual([fun.id, food.id]);
			});

			it("apagados continuam de fora", async () => {
				const gone = await tx.create(expense());
				await tx.softDelete(gone.id);
				expect(await ids({ kinds: ["expense"] })).toEqual([]);
			});

			it("a paginação por cursor segue valendo sobre o resultado filtrado", async () => {
				const dates = ["2026-11-01", "2026-11-03", "2026-11-03", "2026-11-03", "2026-11-04", "2026-11-03"];
				const wanted = [];
				for (const [i, date] of dates.entries()) {
					// Metade é despesa, metade é receita: o filtro deixa só as despesas.
					const row = await tx.create(
						i % 2 === 0 ? expense({ date }) : { ...expense({ date }), kind: "income" },
					);
					if (i % 2 === 0) wanted.push(row);
				}
				const seen: string[] = [];
				let before: { date: string; id: string } | undefined;
				for (let page = 0; page < 10; page++) {
					const rows = await tx.listRecent({
						limit: 2,
						filter: { kinds: ["expense"] },
						...(before ? { before } : {}),
					});
					if (rows.length === 0) break;
					seen.push(...rows.map((r) => r.id));
					const last = rows.at(-1);
					if (!last) break;
					before = { date: last.date, id: last.id };
				}
				const expected = [...wanted]
					.sort((x, y) => (x.date === y.date ? (x.id < y.id ? 1 : -1) : x.date < y.date ? 1 : -1))
					.map((r) => r.id);
				expect(seen).toEqual(expected);
			});

			it("countMatching conta com a mesma regra, ignora apagados e valida", async () => {
				await tx.create(expense({ date: "2026-11-01" }));
				await tx.create(expense({ date: "2026-11-02", amountCents: 9000 }));
				const gone = await tx.create(expense({ date: "2026-11-03" }));
				await tx.create({ ...expense({ date: "2026-11-04" }), kind: "income" });
				await tx.softDelete(gone.id);
				expect(await tx.countMatching()).toBe(3);
				expect(await tx.countMatching({})).toBe(3);
				expect(await tx.countMatching({ kinds: ["expense"] })).toBe(2);
				expect(await tx.countMatching({ kinds: ["expense"], minCents: 5000 })).toBe(1);
				expect(await tx.countMatching({ from: "2026-11-02", to: "2026-11-03" })).toBe(1);
				expect(await tx.countMatching({ accountIds: ["nao-existe"] })).toBe(0);
				await expect(tx.countMatching({ minCents: 10, maxCents: 5 })).rejects.toMatchObject({
					code: "invalid",
				});
			});

			it("valida o filtro", async () => {
				const bad = (filter: Parameters<typeof tx.listRecent>[0]["filter"]) =>
					expect(tx.listRecent({ limit: 5, filter })).rejects.toMatchObject({ code: "invalid" });
				await bad({ from: "ontem" });
				await bad({ from: "2026-11-10", to: "2026-11-01" });
				await bad({ minCents: 10, maxCents: 5 });
				await bad({ minCents: -1 });
				await bad({ maxCents: 1.5 });
				await bad({ maxCents: 2_147_483_648 });
				await bad({ kinds: ["nada" as never] });
				await bad({ accountIds: Array.from({ length: 51 }, (_, i) => `id${i}`) });
			});
		});

		it("listInstallmentGroups: só parcelamentos que ainda têm parcela a partir do mês", async () => {
			const make = (invoices: string[], description: string) =>
				tx.createInstallmentGroup(
					invoices.map((invoiceMonth, i) => ({
						...cardPurchase({ invoiceMonth, description }),
						installmentNumber: i + 1,
						installmentCount: invoices.length,
					})),
				);
			const ended = await make(["2026-09", "2026-10"], "Acabou");
			const ongoing = await make(["2026-10", "2026-11", "2026-12"], "Em andamento");
			const starting = await make(["2027-01"], "Começa depois");
			await tx.create(cardPurchase());
			const groups = await tx.listInstallmentGroups("2026-11");
			const ids = groups.map((g) => g.groupId).sort();
			expect(ids).toEqual([ongoing[0]?.installmentGroupId, starting[0]?.installmentGroupId].sort());
			expect(ids).not.toContain(ended[0]?.installmentGroupId);
			// O grupo vem inteiro (com as parcelas já pagas), por número.
			const full = groups.find((g) => g.groupId === ongoing[0]?.installmentGroupId);
			expect(full?.installments.map((i) => i.installmentNumber)).toEqual([1, 2, 3]);
			// No limite: a parcela de 2026-09/10 ainda conta a partir de 2026-10.
			expect((await tx.listInstallmentGroups("2026-10")).map((g) => g.groupId)).toContain(
				ended[0]?.installmentGroupId,
			);
			expect((await tx.listInstallmentGroups("2027-02")).length).toBe(0);
		});
	});

	describe("integridade", () => {
		const refund = (originalId: string, extra: Partial<TransactionInput> = {}) =>
			tx.create({
				...expense({ amountCents: 500, description: "Estorno" }),
				kind: "refund",
				refundOfId: originalId,
				...extra,
			});

		it("parcela só nasce por createInstallmentGroup: campos de parcela soltos são descartados ou recusados", async () => {
			const loose = await tx.create({
				...expense(),
				installmentGroupId: "g",
				installmentNumber: 1,
				installmentCount: 3,
			} as TransactionInput);
			expect(loose).toMatchObject({
				installmentGroupId: null,
				installmentNumber: null,
				installmentCount: null,
			});
			await expect(tx.update(loose.id, { installmentNumber: 2 } as never)).rejects.toMatchObject({
				code: "invalid",
				message: "O campo installmentNumber do lançamento não pode ser alterado.",
			});
			await expect(tx.update(loose.id, { source: "pluggy" } as never)).rejects.toMatchObject({
				code: "invalid",
			});
			expect(await tx.get(loose.id)).toEqual(loose);
		});

		it("número de parcela maior que o total derruba o grupo", async () => {
			await expect(
				tx.createInstallmentGroup([{ ...cardPurchase(), installmentNumber: 4, installmentCount: 3 }]),
			).rejects.toMatchObject({ code: "invalid", message: "O número da parcela deve ir de 1 até o total." });
			expect(await tx.listRecent({ limit: 10 })).toEqual([]);
		});

		it("listInstallmentGroups ordena por id do grupo e as parcelas por número", async () => {
			const made = [];
			for (const n of [3, 2, 4]) {
				made.push(
					await tx.createInstallmentGroup(
						Array.from({ length: n }, (_, i) => ({
							...cardPurchase({ date: `2026-11-0${n}` }),
							installmentNumber: i + 1,
							installmentCount: n,
						})),
					),
				);
			}
			const groups = await tx.listInstallmentGroups("2026-01");
			const expected = made.map((g) => g[0]?.installmentGroupId ?? "").sort((x, y) => (x < y ? -1 : 1));
			expect(groups.map((g) => g.groupId)).toEqual(expected);
			for (const g of groups) {
				expect(g.installments.map((i) => i.installmentNumber)).toEqual(
					Array.from({ length: g.installments.length }, (_, i) => i + 1),
				);
			}
		});

		describe("mês do orçamento acompanha a data", () => {
			it("recalcula quando era o padrão", async () => {
				const t = await tx.create(expense({ date: "2026-11-05" }));
				const moved = await tx.update(t.id, { date: "2026-12-02" });
				expect(moved).toMatchObject({ date: "2026-12-02", budgetMonth: "2026-12" });
				expect((await tx.listByBudgetMonth("2026-11")).length).toBe(0);
			});

			it("não mexe quando o mês foi escolhido ou o patch informa um", async () => {
				const chosen = await tx.create(expense({ date: "2026-11-05", budgetMonth: "2026-10" }));
				expect((await tx.update(chosen.id, { date: "2026-12-02" })).budgetMonth).toBe("2026-10");
				const plain = await tx.create(expense({ date: "2026-11-05" }));
				expect((await tx.update(plain.id, { date: "2026-12-02", budgetMonth: "2027-01" })).budgetMonth).toBe(
					"2027-01",
				);
				const same = await tx.create(expense({ date: "2026-11-05" }));
				expect((await tx.update(same.id, { date: "2026-11-28" })).budgetMonth).toBe("2026-11");
			});

			it("parcela mantém o mês do orçamento da própria parcela", async () => {
				const [first] = await tx.createInstallmentGroup([
					{
						...cardPurchase({ date: "2026-11-05", budgetMonth: "2026-11" }),
						installmentNumber: 1,
						installmentCount: 1,
					},
				]);
				const moved = await tx.update(first?.id ?? "", { date: "2026-12-05" });
				expect(moved.budgetMonth).toBe("2026-11");
			});
		});

		describe("estornos acompanham o gasto", () => {
			it("apagar o gasto apaga os estornos vivos (e só eles)", async () => {
				const spent = await tx.create(cardPurchase({ amountCents: 9000 }));
				const r1 = await refund(spent.id, { accountId: null, cardId: b.card.id, invoiceMonth: "2026-11" });
				const r2 = await refund(spent.id);
				const other = await tx.create(expense());
				expect(await tx.softDelete(spent.id)).toBe(true);
				expect(await tx.get(r1.id)).toBeNull();
				expect(await tx.get(r2.id)).toBeNull();
				expect((await tx.listRecent({ limit: 10 })).map((t) => t.id)).toEqual([other.id]);
			});

			it("apagar só o estorno não mexe no gasto", async () => {
				const spent = await tx.create(expense());
				const r = await refund(spent.id);
				await tx.softDelete(r.id);
				expect(await tx.get(spent.id)).not.toBeNull();
			});

			it("apagar um grupo apaga os estornos das parcelas", async () => {
				const rows = await tx.createInstallmentGroup(
					[1, 2].map((n) => ({ ...cardPurchase(), installmentNumber: n, installmentCount: 2 })),
				);
				const r = await refund(rows[0]?.id ?? "", {
					accountId: null,
					cardId: b.card.id,
					invoiceMonth: "2026-11",
				});
				await tx.softDeleteGroup(rows[0]?.installmentGroupId ?? "");
				expect(await tx.get(r.id)).toBeNull();
			});

			it("não deixa mudar o tipo de um gasto que tem estornos; depois de apagá-los, deixa", async () => {
				const spent = await tx.create(expense());
				const r = await refund(spent.id);
				await expect(tx.update(spent.id, { kind: "income" })).rejects.toMatchObject({
					code: "invalid",
					message: "Este gasto tem estornos: apague os estornos antes de mudar o tipo do lançamento.",
				});
				expect((await tx.get(spent.id))?.kind).toBe("expense");
				await tx.softDelete(r.id);
				expect((await tx.update(spent.id, { kind: "income" })).kind).toBe("income");
			});
		});

		describe("conta, cartão e categoria arquivados", () => {
			it("lançamento novo não aponta para arquivado", async () => {
				await stores.accounts.archive(b.savings.id);
				await stores.cards.archive(b.card.id);
				await stores.categories.archive(b.food.id);
				await expect(tx.create(expense({ accountId: b.savings.id }))).rejects.toMatchObject({
					code: "bad_reference",
					message: "A conta informada está arquivada.",
				});
				await expect(tx.create(cardPurchase())).rejects.toMatchObject({
					code: "bad_reference",
					message: "O cartão informado está arquivado.",
				});
				await expect(tx.create(expense({ categoryId: b.food.id }))).rejects.toMatchObject({
					code: "bad_reference",
					message: "A categoria informada está arquivada.",
				});
				await expect(
					tx.create({
						kind: "transfer",
						amountCents: 100,
						date: "2026-11-01",
						description: "x",
						accountId: b.checking.id,
						counterpartAccountId: b.savings.id,
					}),
				).rejects.toMatchObject({ code: "bad_reference", message: "A conta informada está arquivada." });
				await expect(
					tx.createInstallmentGroup([{ ...cardPurchase(), installmentNumber: 1, installmentCount: 1 }]),
				).rejects.toMatchObject({ code: "bad_reference" });
				expect(await tx.listRecent({ limit: 10 })).toEqual([]);
			});

			it("lançamento que já usa o arquivado segue editável; trocar para arquivado não", async () => {
				const t = await tx.create(expense({ categoryId: b.food.id }));
				const other = await stores.categories.create({ slug: "outra", name: "Outra" });
				const other2 = await tx.create(expense({ categoryId: other.id }));
				await stores.categories.archive(b.food.id);
				await stores.categories.archive(other.id);
				expect((await tx.update(t.id, { description: "Mercado" })).categoryId).toBe(b.food.id);
				expect((await tx.update(t.id, { categoryId: b.food.id, note: "n" })).note).toBe("n");
				await expect(tx.update(other2.id, { categoryId: b.food.id })).rejects.toMatchObject({
					code: "bad_reference",
					message: "A categoria informada está arquivada.",
				});
			});
		});

		describe("getMany", () => {
			it("devolve só os vivos, sem repetir, de qualquer mês", async () => {
				const a = await tx.create(expense({ date: "2026-03-01" }));
				const c = await tx.create(expense({ date: "2026-11-01" }));
				const gone = await tx.create(expense({ date: "2026-06-01" }));
				await tx.softDelete(gone.id);
				const rows = await tx.getMany([c.id, a.id, a.id, gone.id, "nada"]);
				expect(rows.map((r) => r.id)).toEqual([a.id, c.id]);
				expect(await tx.getMany([])).toEqual([]);
			});

			it("valida a lista", async () => {
				await expect(tx.getMany(Array.from({ length: 501 }, (_, i) => `id${i}`))).rejects.toMatchObject({
					code: "invalid",
					message: "Informe de 0 a 500 ids de lançamentos.",
				});
				await expect(tx.getMany([""])).rejects.toMatchObject({ code: "invalid" });
				expect(await tx.getMany(Array.from({ length: 500 }, (_, i) => `id${i}`))).toEqual([]);
			});
		});

		describe("listPending com limite", () => {
			it("padrão 200, limite explícito e validação", async () => {
				for (let d = 1; d <= 5; d++) await tx.create(expense({ status: "pending", date: `2026-11-0${d}` }));
				expect(await tx.listPending()).toHaveLength(5);
				expect((await tx.listPending({ limit: 2 })).map((t) => t.date)).toEqual(["2026-11-05", "2026-11-04"]);
				await expect(tx.listPending({ limit: 0 })).rejects.toMatchObject({ code: "invalid" });
				await expect(tx.listPending({ limit: 501 })).rejects.toMatchObject({ code: "invalid" });
			});
		});
	});
	describe("splitTransaction", () => {
		const parts = (...cents: number[]) => cents.map((amountCents) => ({ amountCents }));

		it("troca o original por partes que somam o mesmo valor, com categorias próprias", async () => {
			const lazer = await stores.categories.create({ slug: "lazer", name: "Lazer", chartSlot: 4 });
			const original = await tx.create(expense({ amountCents: 4690, description: "Mercadão", note: "mês" }));
			const created = await tx.splitTransaction(original.id, [
				{ amountCents: 3000, categoryId: b.food.id },
				{ amountCents: 1690, categoryId: lazer.id, description: "Cinema" },
			]);
			expect(created.map((t) => [t.amountCents, t.description, t.categoryId])).toEqual([
				[3000, "Mercadão", b.food.id],
				[1690, "Cinema", lazer.id],
			]);
			expect(created.reduce((sum, t) => sum + t.amountCents, 0)).toBe(4690);
			const [first, second] = created;
			expect(first?.splitGroupId).not.toBeNull();
			expect(second?.splitGroupId).toBe(first?.splitGroupId);
			for (const t of created) {
				expect(t).toMatchObject({
					kind: "expense",
					date: "2026-11-05",
					accountId: b.checking.id,
					budgetMonth: "2026-11",
					status: "confirmed",
					source: "manual",
					note: "mês",
					categoryEditedByOwner: true,
					installmentGroupId: null,
				});
			}
			// O original some das buscas; só as partes ficam.
			expect(await tx.get(original.id)).toBeNull();
			const listed = await tx.listRecent({ limit: 10 });
			expect(listed.map((t) => t.id).sort()).toEqual(created.map((t) => t.id).sort());
			expect(await tx.countMatching()).toBe(2);
		});

		it("compra no cartão: as partes ficam na mesma fatura e conservam a situação", async () => {
			const original = await tx.create(cardPurchase({ amountCents: 10001, status: "pending" }));
			const created = await tx.splitTransaction(original.id, parts(5000, 3333, 1668));
			expect(created).toHaveLength(3);
			for (const t of created) {
				expect(t).toMatchObject({ cardId: b.card.id, invoiceMonth: "2026-11", status: "pending" });
			}
			expect(await tx.listByInvoice(b.card.id, "2026-11")).toHaveLength(3);
		});

		it("a identidade externa do original continua reservada: a ingestão não recria o lançamento", async () => {
			const { transaction } = await tx.upsertByExternal("pluggy", "tx-9", {
				kind: "expense",
				amountCents: 900,
				date: "2026-11-05",
				description: "Padaria",
				accountId: b.checking.id,
			});
			const created = await tx.splitTransaction(transaction?.id ?? "", parts(400, 500));
			expect(created.every((t) => t.externalId === null && t.source === "pluggy")).toBe(true);
			expect(await tx.existsByExternal("pluggy", "tx-9")).toBe(true);
			const again = await tx.upsertByExternal("pluggy", "tx-9", {
				kind: "expense",
				amountCents: 900,
				date: "2026-11-05",
				description: "Padaria",
				accountId: b.checking.id,
			});
			expect(again).toEqual({ created: false, transaction: null });
		});

		it("dividir uma parte de novo mantém o mesmo grupo", async () => {
			const original = await tx.create(expense({ amountCents: 1000 }));
			const [a, c] = await tx.splitTransaction(original.id, parts(600, 400));
			const again = await tx.splitTransaction(a?.id ?? "", parts(300, 300));
			expect(
				again.every((t) => t.splitGroupId === a?.splitGroupId && t.splitGroupId === c?.splitGroupId),
			).toBe(true);
		});

		it("receita também pode ser dividida", async () => {
			const original = await tx.create({
				kind: "income",
				amountCents: 1000,
				date: "2026-11-05",
				description: "Freela",
				accountId: b.checking.id,
			});
			expect(await tx.splitTransaction(original.id, parts(700, 300))).toHaveLength(2);
		});

		it.each([
			["soma menor", [3000, 1000], "As partes precisam somar exatamente o valor do lançamento."],
			["soma maior", [3000, 2000], "As partes precisam somar exatamente o valor do lançamento."],
			["uma parte só", [4690], "Divida em 2 a 20 partes."],
			["parte zerada", [4690, 0], "Cada parte precisa ter valor maior que zero."],
			["parte negativa", [5000, -310], "Cada parte precisa ter valor maior que zero."],
			["dinheiro fracionado", [4690.5, 0], "Valor da parte inválido."],
		])("rejeita %s e não muda nada", async (_label, cents, message) => {
			const original = await tx.create(expense({ amountCents: 4690 }));
			await expect(tx.splitTransaction(original.id, parts(...cents))).rejects.toMatchObject({
				code: "invalid",
				message,
			});
			expect(await tx.get(original.id)).toEqual(original);
			expect(await tx.countMatching()).toBe(1);
		});

		it("rejeita mais de 20 partes", async () => {
			const original = await tx.create(expense({ amountCents: 100 }));
			await expect(
				tx.splitTransaction(original.id, parts(...Array.from({ length: 21 }, () => 1))),
			).rejects.toMatchObject({ code: "invalid" });
		});

		it("não divide parcela, transferência, pagamento de fatura nem estorno", async () => {
			const [installment] = await tx.createInstallmentGroup(
				[1, 2].map((n) => ({
					...cardPurchase({ invoiceMonth: `2026-${10 + n}`, amountCents: 1000 }),
					installmentNumber: n,
					installmentCount: 2,
				})),
			);
			const transfer = await tx.create({
				kind: "transfer",
				amountCents: 1000,
				date: "2026-11-05",
				description: "Para poupança",
				accountId: b.checking.id,
				counterpartAccountId: b.savings.id,
			});
			const payment = await tx.create({
				kind: "card_payment",
				amountCents: 1000,
				date: "2026-11-17",
				description: "Fatura",
				accountId: b.checking.id,
				cardId: b.card.id,
			});
			const base = await tx.create(expense({ amountCents: 1000 }));
			const refund = await tx.create({
				kind: "refund",
				amountCents: 1000,
				date: "2026-11-06",
				description: "Estorno",
				accountId: b.checking.id,
				refundOfId: base.id,
			});
			for (const t of [installment, transfer, payment, refund]) {
				await expect(tx.splitTransaction(t?.id ?? "", parts(600, 400))).rejects.toMatchObject({
					code: "invalid",
				});
			}
			// O gasto com estorno vivo também não: o estorno ficaria apontando para uma despesa apagada.
			await expect(tx.splitTransaction(base.id, parts(600, 400))).rejects.toMatchObject({
				code: "invalid",
				message: "Este gasto tem estornos: apague os estornos antes de dividir.",
			});
			expect(await tx.get(base.id)).toEqual(base);
		});

		it("not_found para id que não existe ou já foi apagado", async () => {
			await expect(tx.splitTransaction("nada", parts(1, 1))).rejects.toMatchObject({ code: "not_found" });
			const t = await tx.create(expense({ amountCents: 1000 }));
			await tx.softDelete(t.id);
			await expect(tx.splitTransaction(t.id, parts(600, 400))).rejects.toMatchObject({ code: "not_found" });
		});

		it("categoria arquivada ou inexistente em qualquer parte: nada muda (tudo ou nada)", async () => {
			const archived = await stores.categories.create({ slug: "velha", name: "Velha" });
			await stores.categories.archive(archived.id);
			const original = await tx.create(expense({ amountCents: 1000 }));
			await expect(
				tx.splitTransaction(original.id, [
					{ amountCents: 600, categoryId: b.food.id },
					{ amountCents: 400, categoryId: archived.id },
				]),
			).rejects.toMatchObject({ code: "bad_reference" });
			await expect(
				tx.splitTransaction(original.id, [
					{ amountCents: 600, categoryId: b.food.id },
					{ amountCents: 400, categoryId: "nao-existe" },
				]),
			).rejects.toMatchObject({ code: "bad_reference" });
			expect(await tx.get(original.id)).toEqual(original);
			expect(await tx.countMatching()).toBe(1);
		});

		it("a ligação do original com uma recorrência é desfeita (ele foi apagado)", async () => {
			const rec = await stores.recurrences.create({
				kind: "expense",
				name: "Padaria",
				amountCents: 1000,
				dayOfMonth: 5,
				startDate: "2026-01-05",
				accountId: b.checking.id,
			});
			const original = await tx.create(expense({ amountCents: 1000, description: "Padaria" }));
			await stores.recurrences.recordPosting({
				recurrenceId: rec.id,
				month: "2026-11",
				transactionId: original.id,
			});
			await tx.splitTransaction(original.id, parts(600, 400));
			expect(await stores.recurrences.listPostings("2026-11")).toEqual([]);
		});
	});
});
