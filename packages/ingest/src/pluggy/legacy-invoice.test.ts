import { createMemoryStores, type Stores } from "@orbita/db";
import { describe, expect, it } from "vitest";
import { CLIENT_ID, CLIENT_SECRET, fakePluggy } from "./fake-pluggy.ts";
import { ITEMS, REAL_NOW, realPluggyOptions } from "./real-data.fixture.ts";
import { syncPluggy } from "./sync.ts";

/* Dados FICTÍCIOS (fixture anonimizada). Sync de versão antiga (isOpenFinance=true usava billForecastDate) seguido do atual. */

const LABELS: Array<[string, string]> = [
	[ITEMS.inter, "Inter"],
	[ITEMS.mp, "Mercado Pago"],
	[ITEMS.santander, "Santander"],
	[ITEMS.nubank, "Nubank"],
];

async function run(stores: Stores, openFinance: boolean) {
	for (const [id, label] of LABELS) {
		if (!(await stores.pluggyConnections.list()).some((c) => c.id === id)) {
			await stores.pluggyConnections.add({ id, label });
		}
	}
	const { itemId: _itemId, ...o } = realPluggyOptions();
	const flip = (it: unknown) => ({
		...(it as { connector: Record<string, unknown> }),
		connector: { ...(it as { connector: Record<string, unknown> }).connector, isOpenFinance: openFinance },
	});
	const others = o.otherItems as Record<string, { item: unknown }>;
	const options = {
		...o,
		item: flip(o.item),
		otherItems: Object.fromEntries(Object.entries(others).map(([k, v]) => [k, { ...v, item: flip(v.item) }])),
	} as typeof o;
	const fake = fakePluggy(options);
	await syncPluggy({
		stores,
		readSecret: async (name) =>
			({ pluggy_client_id: CLIENT_ID, pluggy_client_secret: CLIENT_SECRET })[name] ?? null,
		fetch: fake.fetch,
		now: () => REAL_NOW,
	});
}

const cardRows = async (stores: Stores) =>
	(await stores.transactions.listRecent({ limit: 500 })).filter(
		(t) => t.cardId !== null && t.kind === "expense",
	);

describe("compras PENDING gravadas por versão antiga", () => {
	it("o sync atual recalcula a fatura pelo fechamento (igual a um sync novo)", async () => {
		const fresh = createMemoryStores({ now: () => REAL_NOW });
		await run(fresh, false);
		const expected = new Map((await cardRows(fresh)).map((t) => [t.externalId, t.invoiceMonth]));

		const legacy = createMemoryStores({ now: () => REAL_NOW });
		await run(legacy, true);
		await run(legacy, false);
		const rows = await cardRows(legacy);
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.filter((t) => t.bankPending).length).toBeGreaterThan(0);
		for (const t of rows) expect(t.invoiceMonth, `${t.description} ${t.date}`).toBe(expected.get(t.externalId));
	});
});
