import { createMemoryStores } from "@orbita/db";
import { describe, expect, it } from "vitest";
import {
	BANK_ACCOUNT_ID,
	CARD_ACCOUNT_ID,
	CLIENT_ID,
	CLIENT_SECRET,
	fakePluggy,
	ITEM_ID,
	tx,
} from "./fake-pluggy.ts";
import { type BillInfo, matchPaymentCard } from "./mapping.ts";
import { syncPluggy } from "./sync.ts";

/* Dados FICTÍCIOS. Fatura aberta sintética (soma das compras PENDING) e o pagamento adiantado dela. */

const NOW = new Date("2026-11-12T09:00:00Z");
const pending = (id: string, amount: number, date: string) =>
	tx(id, { description: "Compra", amount, date: `${date}T00:00:00.000Z`, status: "PENDING" });

describe("pagamento adiantado da fatura aberta sintética", () => {
	it("compra nova depois do pagamento não quebra o casamento (soma das pendentes até o dia do débito)", async () => {
		const stores = createMemoryStores({ now: () => NOW });
		await stores.pluggyConnections.add({ id: ITEM_ID, label: "Mercado Pago" });
		const fake = fakePluggy({
			transactions: {
				[BANK_ACCOUNT_ID]: [
					tx("b-1", {
						description: "Pagamento de fatura Cartão de crédito",
						amount: 100,
						date: "2026-11-10T00:00:00.000Z",
					}),
				],
				[CARD_ACCOUNT_ID]: [
					pending("c-1", 60, "2026-11-05"),
					pending("c-2", 40, "2026-11-08"),
					pending("c-3", 25, "2026-11-11"),
				],
			},
		});
		await syncPluggy({
			stores,
			readSecret: async (name) =>
				({ pluggy_client_id: CLIENT_ID, pluggy_client_secret: CLIENT_SECRET })[name] ?? null,
			fetch: fake.fetch,
			now: () => NOW,
		});
		const rows = await stores.transactions.listRecent({ limit: 100 });
		const pay = rows.find((r) => r.externalId === "b-1");
		expect(pay?.kind).toBe("card_payment");
		expect(pay?.cardId).not.toBeNull();
	});

	it("a janela: antes da primeira pendente ou muito depois da última não casa", () => {
		const bills: BillInfo[] = [
			{
				cardId: "c",
				totalCents: 10000,
				remainingCents: 10000,
				dueDate: null,
				pending: [
					{ date: "2026-11-05", amountCents: 6000 },
					{ date: "2026-11-08", amountCents: 4000 },
				],
			},
		];
		const ctx = { bills };
		expect(matchPaymentCard(10000, "x", ctx, "2026-11-10")).toEqual({ kind: "one", cardId: "c" });
		expect(matchPaymentCard(6000, "x", ctx, "2026-11-06")).toEqual({ kind: "one", cardId: "c" });
		expect(matchPaymentCard(10000, "x", ctx, "2026-11-06")).toEqual({ kind: "none" }); // ainda não somava 100
		expect(matchPaymentCard(10000, "x", ctx, "2026-11-01")).toEqual({ kind: "none" }); // antes de tudo
		expect(matchPaymentCard(10000, "x", ctx, "2027-02-10")).toEqual({ kind: "none" }); // meses depois
	});

	it("crédito do cartão com op TARIFA ou OPERACOES_CREDITO_CONTRATADAS_CARTAO não é consumido como pagamento de fatura", async () => {
		const stores = createMemoryStores({ now: () => NOW });
		await stores.pluggyConnections.add({ id: ITEM_ID, label: "Mercado Pago" });
		const credit = (id: string, op: string) =>
			tx(id, {
				description: "Ajuste",
				amount: -50,
				type: "CREDIT",
				date: "2026-11-10T00:00:00.000Z",
				operationType: op,
			});
		const fake = fakePluggy({
			transactions: {
				[BANK_ACCOUNT_ID]: [],
				[CARD_ACCOUNT_ID]: [credit("t-1", "TARIFA"), credit("t-2", "OPERACOES_CREDITO_CONTRATADAS_CARTAO")],
			},
			bills: {
				[CARD_ACCOUNT_ID]: [
					{
						id: "bill-a",
						dueDate: "2026-11-17T00:00:00.000Z",
						totalAmount: 300,
						payments: [{ paymentDate: "2026-11-10T00:00:00.000Z", amount: 50 }],
					},
				],
			},
		});
		const result = await syncPluggy({
			stores,
			readSecret: async (name) =>
				({ pluggy_client_id: CLIENT_ID, pluggy_client_secret: CLIENT_SECRET })[name] ?? null,
			fetch: fake.fetch,
			now: () => NOW,
		});
		expect(result.connections[0]?.skipped?.card_payment ?? 0).toBe(0);
		const rows = await stores.transactions.listRecent({ limit: 100 });
		expect(rows.filter((r) => ["t-1", "t-2"].includes(r.externalId ?? "")).length).toBe(2);
	});
});
