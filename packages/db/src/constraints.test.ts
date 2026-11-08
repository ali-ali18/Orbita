import { afterAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "./client.ts";
import { cleanDatabase } from "./contract-harness.ts";

// Os CHECKs da migração são a última defesa: valem mesmo para quem escrever SQL direto.
const url = process.env.DATABASE_URL_TEST;
let db: Db | undefined;
afterAll(async () => db?.$disconnect());

describe.skipIf(!url)("CHECKs do Postgres", () => {
	const client = () => {
		db ??= createDb(url as string);
		return db;
	};
	const rejects = async (sql: string) => {
		const c = client();
		await cleanDatabase(c);
		await expect(c.$executeRawUnsafe(sql)).rejects.toThrow(/check constraint/i);
	};
	const account = `INSERT INTO accounts (id, name, kind, updated_at) VALUES ('a1', 'A', 'checking', now())`;
	const tx = (cols: string, vals: string) =>
		`INSERT INTO transactions (id, kind, amount_cents, date, description, budget_month, updated_at${cols}) VALUES ('t1', 'expense', 100, '2026-11-05', 'x', '2026-11', now()${vals})`;

	it("cartão: dias 1..31, last4 com 4 dígitos, limite >= 0", async () => {
		const card = (extra: string) =>
			`INSERT INTO cards (id, name, closing_day, due_day, updated_at${extra.split("|")[0]}) VALUES ('c1', 'C', 10, 10, now()${extra.split("|")[1]})`;
		await rejects(card(", last4|, 'abc1'"));
		await rejects(
			`INSERT INTO cards (id, name, closing_day, due_day, updated_at) VALUES ('c1', 'C', 0, 10, now())`,
		);
		await rejects(
			`INSERT INTO cards (id, name, closing_day, due_day, updated_at) VALUES ('c1', 'C', 10, 32, now())`,
		);
		await rejects(card(", limit_cents|, -1"));
	});

	it("lançamento: valor > 0, mês no formato, fatura só em cartão, parcelas coerentes", async () => {
		const c = client();
		await cleanDatabase(c);
		await c.$executeRawUnsafe(account);
		await c.$executeRawUnsafe(
			`INSERT INTO cards (id, name, closing_day, due_day, updated_at) VALUES ('c1', 'C', 10, 17, now())`,
		);
		const bad = [
			tx(", account_id", ", 'a1'").replace("100,", "0,"),
			tx(", account_id", ", 'a1'").replace("'2026-11', now()", "'2026-13', now()"),
			tx(", account_id, invoice_month", ", 'a1', '2026-11'"),
			tx(", card_id", ", 'c1'"),
			tx(", account_id, installment_group_id", ", 'a1', 'g'"),
			tx(", account_id, installment_group_id, installment_number, installment_count", ", 'a1', 'g', 5, 3"),
		];
		for (const sql of bad) await expect(c.$executeRawUnsafe(sql)).rejects.toThrow(/check constraint/i);
		await expect(c.$executeRawUnsafe(tx(", account_id", ", 'a1'"))).resolves.toBe(1);
		await expect(
			c.$executeRawUnsafe(tx(", card_id, invoice_month", ", 'c1', '2026-12'").replace("'t1'", "'t2'")),
		).resolves.toBe(1);
	});

	it("recorrência, categoria, orçamento e posting", async () => {
		await rejects(
			`INSERT INTO recurrences (id, kind, name, amount_cents, day_of_month, start_date, updated_at) VALUES ('r1', 'expense', 'R', 0, 5, '2026-01-01', now())`,
		);
		await rejects(
			`INSERT INTO recurrences (id, kind, name, amount_cents, day_of_month, start_date, updated_at) VALUES ('r1', 'expense', 'R', 10, 32, '2026-01-01', now())`,
		);
		await rejects(
			`INSERT INTO recurrences (id, kind, name, amount_cents, day_of_month, start_date, end_date, updated_at) VALUES ('r1', 'expense', 'R', 10, 5, '2026-01-01', '2025-01-01', now())`,
		);
		await rejects(
			`INSERT INTO categories (id, slug, name, chart_slot, updated_at) VALUES ('k1', 's', 'S', 10, now())`,
		);
		await expect(
			client().$executeRawUnsafe(
				`INSERT INTO categories (id, slug, name, chart_slot, updated_at) VALUES ('k1', 's', 'S', 9, now())`,
			),
		).resolves.toBe(1);
		await rejects(
			`INSERT INTO budgets (id, scope, limit_cents, updated_at) VALUES ('b1', 'total', -1, now())`,
		);
	});

	it("recorrência tem conta OU cartão, nunca os dois nem nenhum", async () => {
		const c = client();
		await cleanDatabase(c);
		await c.$executeRawUnsafe(account);
		await c.$executeRawUnsafe(
			`INSERT INTO cards (id, name, closing_day, due_day, updated_at) VALUES ('c1', 'C', 10, 17, now())`,
		);
		const rec = (cols: string, vals: string) =>
			`INSERT INTO recurrences (id, kind, name, amount_cents, day_of_month, start_date, updated_at${cols}) VALUES ('r1', 'expense', 'R', 10, 5, '2026-01-01', now()${vals})`;
		await expect(c.$executeRawUnsafe(rec("", ""))).rejects.toThrow(/check constraint/i);
		await expect(c.$executeRawUnsafe(rec(", account_id, card_id", ", 'a1', 'c1'"))).rejects.toThrow(
			/check constraint/i,
		);
		await expect(c.$executeRawUnsafe(rec(", account_id", ", 'a1'"))).resolves.toBe(1);
	});

	it("parcela única por grupo e número", async () => {
		const c = client();
		await cleanDatabase(c);
		await c.$executeRawUnsafe(account);
		const row = (id: string, number: number) =>
			`INSERT INTO transactions (id, kind, amount_cents, date, description, budget_month, account_id, installment_group_id, installment_number, installment_count, updated_at) VALUES ('${id}', 'expense', 100, '2026-11-05', 'x', '2026-11', 'a1', 'g', ${number}, 3, now())`;
		await expect(c.$executeRawUnsafe(row("t1", 1))).resolves.toBe(1);
		await expect(c.$executeRawUnsafe(row("t2", 1))).rejects.toThrow(/unique|duplicate/i);
		await expect(c.$executeRawUnsafe(row("t3", 2))).resolves.toBe(1);
	});

	it("não dá para apagar conta ou cartão que lançamentos usam (RESTRICT, sem SET NULL)", async () => {
		const c = client();
		await cleanDatabase(c);
		await c.$executeRawUnsafe(account);
		await c.$executeRawUnsafe(tx(", account_id", ", 'a1'"));
		await expect(c.$executeRawUnsafe(`DELETE FROM accounts WHERE id = 'a1'`)).rejects.toThrow(
			/foreign key|violates/i,
		);
	});
});
