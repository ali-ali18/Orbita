import { describe, expect, it } from "vitest";
import {
	accountCreateBody,
	budgetSetBody,
	cardCreateBody,
	cardUpdateBody,
	categoryCreateBody,
	isLocalDate,
	isMonthKey,
	recentTransactionsQuery,
	recurrenceCreateBody,
	transactionCreateBody,
	transactionInvariantError,
	transactionSplitBody,
	transactionUpdateBody,
} from "./index.ts";

const expense = {
	kind: "expense",
	amountCents: 1990,
	date: "2026-11-05",
	description: "Padaria",
	accountId: "a1",
};
const message = (r: { success: boolean; error?: { issues: Array<{ message: string }> } }) =>
	r.error?.issues[0]?.message;

describe("datas e meses", () => {
	it.each(["2026-02-28", "2024-02-29", "2026-12-31"])("%s é data", (d) => expect(isLocalDate(d)).toBe(true));
	it.each(["2026-02-30", "2025-02-29", "2026-13-01", "26-01-01", "2026-1-1", ""])("%s não é data", (d) =>
		expect(isLocalDate(d)).toBe(false),
	);
	it("meses", () => {
		expect(isMonthKey("2026-12")).toBe(true);
		expect(isMonthKey("2026-00")).toBe(false);
		expect(isMonthKey("2026-13")).toBe(false);
	});
});

describe("lançamento", () => {
	it("aceita despesa em conta e compra no cartão", () => {
		expect(transactionCreateBody.safeParse(expense).success).toBe(true);
		const card = { ...expense, accountId: undefined, cardId: "c1", invoiceMonth: "2026-11" };
		expect(transactionCreateBody.safeParse(card).success).toBe(true);
	});

	it("traz as mesmas mensagens das regras do banco", () => {
		const bad = transactionCreateBody.safeParse({ ...expense, accountId: undefined });
		expect(message(bad)).toBe("Informe a conta ou o cartão (apenas um dos dois).");
		expect(transactionInvariantError({ ...expense, kind: "expense", accountId: null })).toBe(message(bad));
	});

	it("valor em reais com vírgula, negativo ou fracionário é recusado", () => {
		for (const amountCents of [0, -1, 10.5, "19,90", 2_147_483_648]) {
			expect(transactionCreateBody.safeParse({ ...expense, amountCents }).success).toBe(false);
		}
	});

	it("campo desconhecido é erro (a origem não vem do cliente)", () => {
		expect(transactionCreateBody.safeParse({ ...expense, source: "pluggy" }).success).toBe(false);
	});

	it("update parcial deixa limpar com null e não aceita zero", () => {
		expect(transactionUpdateBody.safeParse({ categoryId: null, note: null }).success).toBe(true);
		expect(transactionUpdateBody.safeParse({ amountCents: 0 }).success).toBe(false);
		expect(transactionUpdateBody.safeParse({}).success).toBe(true);
	});

	it("paginação: limite padrão e teto", () => {
		expect(recentTransactionsQuery.parse({}).limit).toBe(50);
		expect(recentTransactionsQuery.safeParse({ limit: "500" }).success).toBe(false);
		expect(
			recentTransactionsQuery.parse({ limit: "20", beforeDate: "2026-11-05", beforeId: "x" }).limit,
		).toBe(20);
	});
});

describe("cadastros", () => {
	it("conta", () => {
		expect(accountCreateBody.parse({ name: " Itaú ", kind: "checking", bankCode: "60701190" }).name).toBe(
			"Itaú",
		);
		expect(message(accountCreateBody.safeParse({ name: "X", kind: "crypto" }))).toBe(
			"Tipo de conta inválido.",
		);
		expect(accountCreateBody.safeParse({ name: "X", kind: "wallet", bankCode: "123" }).success).toBe(false);
	});

	it("cartão: regra ausente fica ausente (o store decide a origem), nunca no PATCH", () => {
		const body = { name: "Nubank", closingDay: 10, dueDay: 17 };
		expect(cardCreateBody.parse(body)).not.toHaveProperty("closingRule");
		expect(cardCreateBody.parse({ ...body, closingRule: "closing-day-included" }).closingRule).toBe(
			"closing-day-included",
		);
		expect(cardUpdateBody.parse({ dueDay: 20 })).toEqual({ dueDay: 20 });
		expect(cardCreateBody.safeParse({ ...body, closingDay: 32 }).success).toBe(false);
		expect(cardCreateBody.safeParse({ ...body, last4: "12a4" }).success).toBe(false);
	});

	it("categoria, recorrência e orçamento", () => {
		expect(categoryCreateBody.safeParse({ slug: "pets", name: "Pets", chartSlot: 9 }).success).toBe(true);
		expect(categoryCreateBody.safeParse({ slug: "Pets", name: "Pets" }).success).toBe(false);
		expect(categoryCreateBody.safeParse({ slug: "pets", name: "Pets", chartSlot: 10 }).success).toBe(false);
		const rent = {
			kind: "expense",
			name: "Aluguel",
			amountCents: 250000,
			dayOfMonth: 5,
			startDate: "2026-01-05",
		};
		expect(recurrenceCreateBody.safeParse({ ...rent, accountId: "a1" }).success).toBe(true);
		expect(message(recurrenceCreateBody.safeParse(rent))).toBe(
			"Informe a conta ou o cartão (apenas um dos dois).",
		);
		expect(recurrenceCreateBody.safeParse({ ...rent, accountId: "a1", cardId: "c1" }).success).toBe(false);
		expect(message(recurrenceCreateBody.safeParse({ ...rent, accountId: "a1", endDate: "2025-01-01" }))).toBe(
			"O fim não pode ser antes do início.",
		);
		expect(budgetSetBody.safeParse({ scope: "total", limitCents: 0 }).success).toBe(true);
		expect(budgetSetBody.safeParse({ scope: "total", limitCents: -1 }).success).toBe(false);
	});
});

describe("limites de ano e receita no cartão", () => {
	it("datas e meses só de 1900 a 2199", () => {
		expect(isLocalDate("1900-01-01")).toBe(true);
		expect(isLocalDate("2199-12-31")).toBe(true);
		expect(isLocalDate("1899-12-31")).toBe(false);
		expect(isLocalDate("2200-01-01")).toBe(false);
		expect(isLocalDate("0000-01-01")).toBe(false);
		expect(isLocalDate("9999-12-15")).toBe(false);
		expect(isMonthKey("1900-01")).toBe(true);
		expect(isMonthKey("2199-12")).toBe(true);
		expect(isMonthKey("0000-01")).toBe(false);
		expect(isMonthKey("2200-01")).toBe(false);
	});

	it("receita não usa cartão", () => {
		const income = { kind: "income" as const, amountCents: 100, date: "2026-11-01", description: "Cashback" };
		expect(transactionInvariantError({ ...income, cardId: "c1", invoiceMonth: "2026-12" })).toContain(
			"estorno",
		);
		expect(transactionInvariantError({ ...income, accountId: "a1" })).toBeNull();
	});

	it("transferência nunca tem cartão: compra no cartão é despesa (só pagamento de fatura liga conta e cartão)", () => {
		const base = {
			kind: "transfer" as const,
			amountCents: 799,
			date: "2026-10-19",
			description: "Google YouTube",
		};
		expect(transactionInvariantError({ ...base, cardId: "c1", invoiceMonth: "2026-10" })).toBe(
			"A transferência precisa de uma conta.",
		);
		expect(transactionInvariantError({ ...base, accountId: "a1", cardId: "c1" })).toBe(
			"Transferência não usa cartão.",
		);
		expect(transactionInvariantError({ ...base, accountId: "a1" })).toBeNull();
	});
});

describe("divisão de lançamento", () => {
	const part = (amountCents: number, extra: object = {}) => ({ amountCents, ...extra });
	it("aceita de 2 a 20 partes com centavos inteiros positivos", () => {
		expect(
			transactionSplitBody.safeParse({ parts: [part(3000, { categoryId: "c1" }), part(1690)] }).success,
		).toBe(true);
		expect(transactionSplitBody.safeParse({ parts: [part(100)] }).success).toBe(false);
		expect(transactionSplitBody.safeParse({ parts: Array.from({ length: 21 }, () => part(1)) }).success).toBe(
			false,
		);
		expect(transactionSplitBody.safeParse({ parts: Array.from({ length: 20 }, () => part(1)) }).success).toBe(
			true,
		);
	});
	it("rejeita valor fracionado, zero, negativo e campo desconhecido", () => {
		for (const bad of [10.5, 0, -5]) {
			expect(transactionSplitBody.safeParse({ parts: [part(bad), part(10)] }).success).toBe(false);
		}
		expect(transactionSplitBody.safeParse({ parts: [part(10, { kind: "income" }), part(10)] }).success).toBe(
			false,
		);
	});
});

describe("transactionInvariantError: estorno sem a despesa original", () => {
	const refund = {
		kind: "refund",
		amountCents: 1500,
		date: "2026-11-05",
		description: "ESTORNO AMAZON",
		cardId: "c1",
		invoiceMonth: "2026-12",
	} as const;

	it("o dono (manual) sempre aponta a despesa original", () => {
		expect(transactionInvariantError(refund)).toBe("O estorno precisa apontar para a despesa original.");
		expect(transactionInvariantError({ ...refund, source: "manual" })).toBe(
			"O estorno precisa apontar para a despesa original.",
		);
	});

	it("o banco (Pluggy) pode trazer crédito no cartão sem achar a compra", () => {
		expect(transactionInvariantError({ ...refund, source: "pluggy" })).toBeNull();
	});
});
