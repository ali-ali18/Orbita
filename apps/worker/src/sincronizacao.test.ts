import { createMemoryStores } from "@orbita/db";
import { PLUGGY_DAILY_JOB, PLUGGY_MANUAL_JOB, PLUGGY_RETRY_JOB, type SyncPluggyResult } from "@orbita/ingest";
import { describe, expect, it } from "vitest";
import {
	PLUGGY_RETRY_AFTER_UPDATE_MS,
	PLUGGY_RETRY_DELAYS_MS,
	planPluggyRetry,
	pluggyRetryJobId,
	processSyncJob,
	retryAttemptOf,
} from "./sincronizacao.ts";

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
		for (const name of [PLUGGY_DAILY_JOB, PLUGGY_MANUAL_JOB, PLUGGY_RETRY_JOB]) {
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

describe("nova tentativa quando uma conexão espera o banco", () => {
	const conn = (retry?: SyncPluggyResult["connections"][number]["retry"]) => ({
		id: ITEM,
		status: "partial" as const,
		error: null,
		accounts: 0,
		created: 0,
		existing: 0,
		failed: 0,
		skipped: {},
		notes: [],
		...(retry ? { retry } : {}),
	});
	const result = (...connections: ReturnType<typeof conn>[]): SyncPluggyResult => ({
		status: "partial",
		connections,
	});

	it("nada esperando: não agenda", () => {
		expect(planPluggyRetry(result(conn()), 0, now())).toBeNull();
		expect(planPluggyRetry({ status: "no_keys", connections: [] }, 0, now())).toBeNull();
	});

	it("espera crescente: 2, 5, 15, 30 e 60 minutos", () => {
		const waiting = result(conn(), conn({ reason: "updating" }));
		const delays = PLUGGY_RETRY_DELAYS_MS.map((_, attempt) => planPluggyRetry(waiting, attempt, now()));
		expect(delays.map((d) => d?.delayMs)).toEqual([2, 5, 15, 30, 60].map((m) => m * 60_000));
		expect(delays.map((d) => d?.attempt)).toEqual([1, 2, 3, 4, 5]);
	});

	it("depois das esperas: mais uma só, logo após a atualização que o Pluggy anunciou", () => {
		const last = PLUGGY_RETRY_DELAYS_MS.length;
		const at = "2026-11-08T08:00:00.000Z"; // 23 h depois de `now`
		const waiting = result(
			conn({ reason: "no_accounts", notBefore: at }),
			conn({ reason: "no_accounts", notBefore: "2026-11-09T08:00:00.000Z" }),
		);
		expect(planPluggyRetry(waiting, last, now())).toEqual({
			attempt: last + 1,
			delayMs: 23 * 3_600_000 + PLUGGY_RETRY_AFTER_UPDATE_MS,
		});
		// Sem data anunciada, ou com ela no passado, para: o job diário cobre.
		expect(planPluggyRetry(result(conn({ reason: "no_accounts" })), last, now())).toBeNull();
		expect(
			planPluggyRetry(
				result(conn({ reason: "updating", notBefore: "2026-11-07T08:00:00.000Z" })),
				last,
				now(),
			),
		).toBeNull();
		// Nunca passa disso: a cadeia tem fim.
		expect(planPluggyRetry(waiting, last + 1, now())).toBeNull();
		expect(planPluggyRetry(waiting, -1, now())).toBeNull();
		expect(planPluggyRetry(waiting, 1.5, now())).toBeNull();
	});

	it("o número da tentativa vem do job; o diário e o do app valem zero", () => {
		expect(retryAttemptOf(PLUGGY_RETRY_JOB, { attempt: 3 })).toBe(3);
		expect(retryAttemptOf(PLUGGY_RETRY_JOB, { attempt: "3" })).toBe(0);
		expect(retryAttemptOf(PLUGGY_RETRY_JOB, null)).toBe(0);
		expect(retryAttemptOf(PLUGGY_MANUAL_JOB, { attempt: 3 })).toBe(0);
		expect(pluggyRetryJobId(2)).toBe(`${PLUGGY_RETRY_JOB}-2`);
	});
});
