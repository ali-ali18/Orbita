import { afterAll } from "vitest";
import { createDb, type Db } from "./client.ts";
import { createMemoryStores, createPrismaStores, type Stores } from "./stores.ts";

/**
 * Cada contrato roda na memória sempre e no Postgres quando `DATABASE_URL_TEST` aponta para um
 * banco descartável (o CI sempre aponta). As tabelas são limpas antes de cada teste.
 */
const testUrl = process.env.DATABASE_URL_TEST;
let db: Db | undefined;

/** Relógio que anda 1 s por chamada: a ordem de criação fica determinística nas duas implementações. */
export function tickingClock(start = "2026-11-06T12:00:00Z") {
	let t = new Date(start).getTime();
	return () => {
		t += 1000;
		return new Date(t);
	};
}

export async function cleanDatabase(client: Db): Promise<void> {
	// Ordem das chaves estrangeiras: quem aponta vem antes de quem é apontado.
	await client.recurrencePosting.deleteMany();
	await client.transaction.deleteMany();
	await client.recurrence.deleteMany();
	await client.budget.deleteMany();
	await client.card.deleteMany();
	await client.account.deleteMany();
	await client.category.deleteMany();
	await client.serverSecret.deleteMany();
}

export type StoresFactory = () => Promise<Stores>;

export function contractSuites(): Array<[string, StoresFactory]> {
	const suites: Array<[string, StoresFactory]> = [
		["memória", async () => createMemoryStores({ now: tickingClock() })],
	];
	if (testUrl) {
		suites.push([
			"postgres",
			async () => {
				db ??= createDb(testUrl);
				await cleanDatabase(db);
				return createPrismaStores(db, { now: tickingClock() });
			},
		]);
	}
	afterAll(async () => {
		await db?.$disconnect();
		db = undefined;
	});
	return suites;
}

/** Conta, cartão e categoria prontos para os testes de lançamento. */
export async function seedBasics(stores: Stores) {
	const checking = await stores.accounts.create({
		name: "Conta corrente",
		kind: "checking",
		bankCode: "00000000",
	});
	const savings = await stores.accounts.create({ name: "Poupança", kind: "savings" });
	const card = await stores.cards.create({ name: "Nubank", closingDay: 10, dueDay: 17, last4: "1234" });
	const food = await stores.categories.create({ slug: "mercado", name: "Mercado", chartSlot: 0 });
	return { checking, savings, card, food };
}
