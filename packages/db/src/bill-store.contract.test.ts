import { beforeEach, describe, expect, it } from "vitest";
import type { BillInput } from "./bill-store.ts";
import { contractSuites } from "./contract-harness.ts";
import type { Stores } from "./stores.ts";

describe.each(contractSuites())("BillStore (%s)", (_name, make) => {
	let stores: Stores;
	let cardId: string;
	const at = new Date("2026-11-09T12:00:00Z");
	const bill = (over: Partial<BillInput> = {}): BillInput => ({
		cardId,
		source: "pluggy",
		externalId: "bill-1",
		closeDate: "2026-11-10",
		dueDate: "2026-11-17",
		totalAmountCents: 53_833,
		minimumPaymentCents: 8_075,
		payments: [{ externalId: "p1", amountCents: 10_000, date: "2026-11-12" }],
		syncedAt: at,
		...over,
	});
	beforeEach(async () => {
		stores = await make();
		cardId = (await stores.cards.create({ name: "N", closingDay: 10, dueDay: 17 })).id;
	});

	it("grava com defaults e devolve o que a fase de leitura precisa", async () => {
		const saved = await stores.bills.upsert(bill());
		expect(saved).toMatchObject({
			cardId,
			source: "pluggy",
			externalId: "bill-1",
			closeDate: "2026-11-10",
			dueDate: "2026-11-17",
			totalAmountCents: 53_833,
			minimumPaymentCents: 8_075,
			currency: "BRL",
			syncedAt: at,
			payments: [{ externalId: "p1", amountCents: 10_000, date: "2026-11-12" }],
		});
		expect(await stores.bills.get(saved.id)).toEqual(saved);
		expect(await stores.bills.findByExternal("pluggy", "bill-1")).toEqual(saved);
		expect(await stores.bills.findByExternal("pluggy", "nada")).toBeNull();
	});

	it("campos opcionais ausentes viram null e sem pagamentos a lista é vazia", async () => {
		const saved = await stores.bills.upsert({
			cardId,
			source: "pluggy",
			externalId: "bill-2",
			dueDate: "2026-11-17",
			totalAmountCents: 0,
			syncedAt: at,
		});
		expect(saved).toMatchObject({ closeDate: null, minimumPaymentCents: null, payments: [] });
	});

	it("repetir é idempotente: mesma fatura (mesmo id), campos e pagamentos substituídos", async () => {
		const first = await stores.bills.upsert(bill());
		const later = new Date("2026-11-10T12:00:00Z");
		const again = await stores.bills.upsert(
			bill({
				totalAmountCents: 60_000,
				syncedAt: later,
				payments: [
					{ externalId: null, amountCents: 5_000, date: "2026-11-15" },
					{ externalId: "p1", amountCents: 10_000, date: "2026-11-12" },
				],
			}),
		);
		expect(again.id).toBe(first.id);
		expect(again).toMatchObject({ totalAmountCents: 60_000, syncedAt: later });
		expect(again.payments.map((p) => p.date)).toEqual(["2026-11-12", "2026-11-15"]);
		expect(await stores.bills.list()).toEqual([again]);
		const cleared = await stores.bills.upsert(bill({ payments: [], syncedAt: later }));
		expect(cleared.payments).toEqual([]);
	});

	it("lista por cartão, do vencimento mais recente ao mais antigo", async () => {
		const other = await stores.cards.create({ name: "O", closingDay: 1, dueDay: 8 });
		await stores.bills.upsert(bill({ externalId: "a", dueDate: "2026-09-17" }));
		await stores.bills.upsert(bill({ externalId: "b", dueDate: "2026-11-17" }));
		await stores.bills.upsert(bill({ externalId: "c", dueDate: "2026-10-17" }));
		await stores.bills.upsert(bill({ externalId: "d", cardId: other.id, dueDate: "2026-12-08" }));
		expect((await stores.bills.listByCard(cardId)).map((b) => b.externalId)).toEqual(["b", "c", "a"]);
		expect((await stores.bills.list()).map((b) => b.externalId)).toEqual(["d", "b", "c", "a"]);
		expect(await stores.bills.listByCard("nada")).toEqual([]);
	});

	it("recusa cartão inexistente, origem manual, valor quebrado e data inválida", async () => {
		await expect(stores.bills.upsert(bill({ cardId: "nada" }))).rejects.toMatchObject({
			code: "bad_reference",
		});
		await expect(stores.bills.upsert(bill({ source: "manual" }))).rejects.toMatchObject({ code: "invalid" });
		await expect(stores.bills.upsert(bill({ totalAmountCents: 10.5 }))).rejects.toMatchObject({
			code: "invalid",
		});
		await expect(stores.bills.upsert(bill({ dueDate: "17/11/2026" }))).rejects.toMatchObject({
			code: "invalid",
		});
		await expect(
			stores.bills.upsert(bill({ payments: [{ externalId: null, amountCents: 1, date: "ontem" }] })),
		).rejects.toMatchObject({ code: "invalid" });
		expect(await stores.bills.list()).toEqual([]);
	});
});
