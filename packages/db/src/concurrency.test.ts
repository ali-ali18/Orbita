import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "./client.ts";
import { cleanDatabase, seedBasics } from "./contract-harness.ts";
import { createPrismaStores, type Stores } from "./stores.ts";

// Corridas de verdade só existem com o Postgres (a memória é síncrona e não corre).
const url = process.env.DATABASE_URL_TEST;
let db: Db | undefined;
afterAll(async () => db?.$disconnect());

describe.skipIf(!url)("concorrência no Postgres", () => {
	let stores: Stores;
	let b: Awaited<ReturnType<typeof seedBasics>>;
	beforeEach(async () => {
		db ??= createDb(url as string);
		await cleanDatabase(db);
		stores = createPrismaStores(db);
		b = await seedBasics(stores);
	});

	const base = () => ({
		kind: "expense" as const,
		amountCents: 1000,
		date: "2026-11-05",
		description: "Original",
		accountId: b.checking.id,
	});

	it("duas edições em paralelo de campos diferentes mantêm as duas", async () => {
		for (let round = 0; round < 8; round++) {
			const t = await stores.transactions.create(base());
			await Promise.all([
				stores.transactions.update(t.id, { description: `Nova ${round}` }),
				stores.transactions.update(t.id, { note: `Nota ${round}`, amountCents: 2000 + round }),
				stores.transactions.update(t.id, { categoryId: b.food.id }),
			]);
			expect(await stores.transactions.get(t.id)).toMatchObject({
				description: `Nova ${round}`,
				note: `Nota ${round}`,
				amountCents: 2000 + round,
				categoryId: b.food.id,
			});
		}
	});

	it("editar enquanto apagam: ou edita e depois apaga, ou dá not_found; nunca ressuscita", async () => {
		const t = await stores.transactions.create(base());
		const [edit] = await Promise.allSettled([
			stores.transactions.update(t.id, { note: "x" }),
			stores.transactions.softDelete(t.id),
		]);
		expect(["fulfilled", "rejected"]).toContain(edit.status);
		expect(await stores.transactions.get(t.id)).toBeNull();
	});

	it("várias ingestões iguais ao mesmo tempo criam um lançamento só", async () => {
		const input = { ...base(), status: "pending" as const };
		const results = await Promise.all(
			Array.from({ length: 8 }, () => stores.transactions.upsertByExternal("pluggy", "corrida", input)),
		);
		expect(results.filter((r) => r.created)).toHaveLength(1);
		expect(new Set(results.map((r) => r.transaction?.id)).size).toBe(1);
		expect(await stores.transactions.listRecent({ limit: 10 })).toHaveLength(1);
	});

	it("duas ligações da mesma recorrência no mesmo mês: só uma passa", async () => {
		const r = await stores.recurrences.create({
			kind: "expense",
			name: "Aluguel",
			amountCents: 1000,
			dayOfMonth: 5,
			startDate: "2026-01-05",
			accountId: b.checking.id,
		});
		const a = await stores.transactions.create(base());
		const c = await stores.transactions.create(base());
		const results = await Promise.allSettled([
			stores.recurrences.recordPosting({ recurrenceId: r.id, month: "2026-11", transactionId: a.id }),
			stores.recurrences.recordPosting({ recurrenceId: r.id, month: "2026-11", transactionId: c.id }),
		]);
		expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
		expect(await stores.recurrences.listPostings("2026-11")).toHaveLength(1);
	});
});
