import { createMemoryStores } from "@orbita/db";
import { PLUGGY_DAILY_JOB, PLUGGY_MANUAL_JOB } from "@orbita/ingest";
import { describe, expect, it } from "vitest";
import { processSyncJob } from "./sincronizacao.ts";

// Pluggy falso, no formato da API.
const ITEM = "123e4567-e89b-42d3-a456-426614174000";
const ACCOUNT = "0f1d2c3b-aaaa-4bbb-8ccc-000000000001";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function fakeFetch(calls: string[]) {
	return async (url: string): Promise<Response> => {
		const u = new URL(url);
		calls.push(u.pathname);
		if (u.pathname === "/auth") return json({ apiKey: "k".repeat(30) });
		if (u.pathname === `/items/${ITEM}`)
			return json({ id: ITEM, status: "UPDATED", connector: { name: "Banco" } });
		if (u.pathname === "/accounts") {
			return json({
				page: 1,
				totalPages: 1,
				results: [
					{ id: ACCOUNT, type: "BANK", subtype: "CHECKING_ACCOUNT", name: "Conta", currencyCode: "BRL" },
				],
			});
		}
		if (u.pathname === "/v2/transactions") {
			return json({
				next: null,
				results: [
					{
						id: "t-1",
						description: "Mercado",
						amount: -10.1,
						date: "2026-11-03T00:00:00.000Z",
						type: "DEBIT",
						status: "POSTED",
					},
				],
			});
		}
		return json({}, 404);
	};
}

const now = () => new Date("2026-11-07T09:00:00Z");
const secrets = { pluggy_client_id: "id-do-cliente", pluggy_client_secret: "segredo-do-cliente" } as const;

describe("processSyncJob", () => {
	it("o job diário e o pedido do app rodam a mesma sincronização", async () => {
		for (const name of [PLUGGY_DAILY_JOB, PLUGGY_MANUAL_JOB]) {
			const stores = createMemoryStores({ now });
			await stores.pluggyConnections.add({ id: ITEM });
			const calls: string[] = [];
			const result = await processSyncJob(name, {
				stores,
				readSecret: async (n) => secrets[n],
				fetch: fakeFetch(calls),
				now,
			});
			expect(result.status).toBe("ok");
			expect(calls).toContain("/v2/transactions");
			const [row] = await stores.transactions.listRecent({ limit: 10 });
			expect(row).toMatchObject({
				amountCents: 1010,
				source: "pluggy",
				externalId: "t-1",
				status: "confirmed",
			});
		}
	});

	it("sem chaves não chama o Pluggy e não lança (nada de laço de erro)", async () => {
		const stores = createMemoryStores({ now });
		await stores.pluggyConnections.add({ id: ITEM });
		const calls: string[] = [];
		const result = await processSyncJob(PLUGGY_DAILY_JOB, {
			stores,
			readSecret: async () => null,
			fetch: fakeFetch(calls),
			now,
		});
		expect(result.status).toBe("no_keys");
		expect(calls).toEqual([]);
	});

	it("job desconhecido lança", async () => {
		const stores = createMemoryStores({ now });
		await expect(
			processSyncJob("outra-coisa", { stores, readSecret: async () => null, fetch: fakeFetch([]), now }),
		).rejects.toThrow("Tarefa desconhecida: outra-coisa");
	});
});
