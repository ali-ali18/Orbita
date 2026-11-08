import { createMemoryStores } from "@orbita/db";
import { describe, expect, it } from "vitest";
import {
	BANK_ACCOUNT_ID,
	bankAccount,
	CLIENT_ID,
	CLIENT_SECRET,
	cardAccount,
	fakePluggy,
	ITEM_ID,
} from "./fake-pluggy.ts";
import { syncPluggy } from "./sync.ts";

const NOW = new Date("2026-11-08T12:00:00Z");
const freeVisa = {
	...cardAccount,
	name: "FREE VISA",
	marketingName: "FREE VISA",
	number: "4000 **** **** 3143",
};

async function run(connectorName: string, existingCardName?: string) {
	const stores = createMemoryStores({ now: () => NOW });
	await stores.pluggyConnections.add({ id: ITEM_ID, label: "x" });
	const fake = fakePluggy({
		item: { connector: { id: 608, name: connectorName } },
		accounts: [{ ...bankAccount, name: "Conta Corrente" }, freeVisa],
		transactions: { [BANK_ACCOUNT_ID]: [], [freeVisa.id]: [] },
		bills: { [freeVisa.id]: [] },
	});
	const deps = {
		stores,
		readSecret: async (name: string) =>
			({ pluggy_client_id: CLIENT_ID, pluggy_client_secret: CLIENT_SECRET })[name as never] ?? null,
		fetch: fake.fetch,
		now: () => NOW,
	};
	await syncPluggy(deps);
	const card = (await stores.cards.list())[0];
	if (existingCardName !== undefined && card) {
		await stores.cards.update(card.id, { name: existingCardName, bankCode: null });
		await syncPluggy(deps);
	}
	return { stores, card: (await stores.cards.list())[0], account: (await stores.accounts.list())[0] };
}

describe("emissor do cartão vem da conexão, não do nome do cartão", () => {
	it.each(["Santander", "Santander PF", "Banco Santander (Brasil) S.A."])(
		"conector '%s': cartão FREE VISA e conta ganham Santander (ISPB 90400888)",
		async (connector) => {
			const { card, account } = await run(connector);
			expect(card).toMatchObject({ name: "Santander FREE VISA", bankCode: "90400888" });
			expect(account?.bankCode).toBe("90400888");
		},
	);

	it("conector MeuPluggy sem pista: o produto 'FREE VISA' ainda é reconhecido como Santander", async () => {
		const { card } = await run("MeuPluggy");
		expect(card).toMatchObject({ bankCode: "90400888" });
	});

	it("cartão gravado antes só como 'FREE VISA' é corrigido", async () => {
		const { card } = await run("Santander PF", "FREE VISA");
		expect(card).toMatchObject({ name: "Santander FREE VISA", bankCode: "90400888" });
	});
});
