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
				"transferência sem destino",
				() => expense({ kind: "transfer" }),
				"A transferência precisa de conta de origem e de destino.",
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
			[
				"parcela sem total",
				() => expense({ installmentGroupId: "g", installmentNumber: 1 }),
				"Parcelamento precisa de grupo, número e total da parcela.",
			],
			[
				"parcela maior que o total",
				() => expense({ installmentGroupId: "g", installmentNumber: 4, installmentCount: 3 }),
				"O número da parcela deve ir de 1 até o total.",
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

		it("recusa patch que deixa o lançamento inválido e não grava nada", async () => {
			const t = await tx.create(expense());
			await expect(tx.update(t.id, { kind: "transfer" })).rejects.toMatchObject({
				code: "invalid",
				message: "A transferência precisa de conta de origem e de destino.",
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

		it("concorrência: várias chamadas iguais criam uma só", async () => {
			const results = await Promise.all(
				Array.from({ length: 6 }, () => tx.upsertByExternal("pluggy", "corrida", incoming())),
			);
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
			expect(all.map((r) => r.date)).toEqual([...dates].sort().reverse());
		});

		it("listRecent valida o limite e o cursor", async () => {
			await expect(tx.listRecent({ limit: 0 })).rejects.toMatchObject({ code: "invalid" });
			await expect(tx.listRecent({ limit: 501 })).rejects.toMatchObject({ code: "invalid" });
			await expect(tx.listRecent({ limit: 5, before: { date: "ontem", id: "x" } })).rejects.toMatchObject({
				code: "invalid",
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
});
