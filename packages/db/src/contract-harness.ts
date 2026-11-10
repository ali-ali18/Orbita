import { afterAll } from "vitest";
import { createDb, type Db } from "./client.ts";
import type { Clock } from "./memory-state.ts";
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
	await client.agentActivity.deleteMany();
	await client.alert.deleteMany();
	await client.aiUsage.deleteMany();
	await client.aiSettings.deleteMany();
	await client.chatProposal.deleteMany();
	await client.chatMessage.deleteMany();
	await client.chatConversation.deleteMany();
	await client.agent.deleteMany();
	await client.idempotencyKey.deleteMany();
	await client.importBatch.deleteMany();
	await client.notificationInbox.deleteMany();
	await client.appPreferences.deleteMany();
	await client.homeLayout.deleteMany();
	await client.recurrencePosting.deleteMany();
	await client.goalContribution.deleteMany();
	await client.transaction.deleteMany();
	await client.categoryRule.deleteMany();
	await client.recurrence.deleteMany();
	await client.budget.deleteMany();
	await client.goal.deleteMany();
	await client.incomeSource.deleteMany();
	await client.cardBillPayment.deleteMany();
	await client.cardBill.deleteMany();
	await client.card.deleteMany();
	await client.account.deleteMany();
	await client.category.deleteMany();
	await client.serverSecret.deleteMany();
	await client.pluggyConnection.deleteMany();
	await client.pluggyConnectSession.deleteMany();
}

/** `now` troca o relógio (padrão: `tickingClock`); um relógio parado serve para testar empate de data. */
export type StoresFactory = (now?: Clock) => Promise<Stores>;

export function contractSuites(): Array<[string, StoresFactory]> {
	const suites: Array<[string, StoresFactory]> = [
		["memória", async (now) => createMemoryStores({ now: now ?? tickingClock() })],
	];
	if (testUrl) {
		suites.push([
			"postgres",
			async (now) => {
				db ??= createDb(testUrl);
				await cleanDatabase(db);
				return createPrismaStores(db, { now: now ?? tickingClock() });
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
