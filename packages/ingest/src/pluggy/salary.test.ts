import { createMemoryStores, type Stores } from "@orbita/db";
import { beforeEach, describe, expect, it } from "vitest";
import { categorizeSalaryCredits } from "./salary.ts";

const NOW = new Date("2026-11-12T09:00:00Z");
const TODAY = "2026-11-12";

let accountId = "";

async function credit(
	stores: Stores,
	date: string,
	amountCents: number,
	description = "Pix recebido Comércio De Ervas",
	extra: { categoryId?: string | null; merchantName?: string | null } = {},
) {
	return stores.transactions.create({
		kind: "income",
		amountCents,
		date,
		description,
		accountId,
		source: "pluggy",
		externalId: `ext-${date}-${description}`,
		...extra,
	});
}

describe("categorizeSalaryCredits", () => {
	let stores: Stores;
	let salaryId: string;
	beforeEach(async () => {
		stores = createMemoryStores({ now: () => NOW });
		accountId = (await stores.accounts.create({ name: "Conta", kind: "checking" })).id;
		await stores.categories.ensureDefaults();
		salaryId = (await stores.categories.getBySlug("salario"))?.id ?? "";
	});

	it("crédito mensal do mesmo pagador vira Salário (Pix recebido Comércio De Ervas)", async () => {
		const a = await credit(stores, "2026-10-05", 230_000);
		const b = await credit(stores, "2026-11-05", 230_000);
		expect(await categorizeSalaryCredits(stores, TODAY)).toBe(2);
		expect((await stores.transactions.get(a.id))?.categoryId).toBe(salaryId);
		expect((await stores.transactions.get(b.id))?.categoryId).toBe(salaryId);
		// Idempotente: a segunda rodada não muda nada.
		expect(await categorizeSalaryCredits(stores, TODAY)).toBe(0);
	});

	it("respeita a categoria que o dono escolheu e a que já é específica", async () => {
		const mercado = (await stores.categories.getBySlug("mercado"))?.id ?? "";
		const a = await credit(stores, "2026-10-05", 230_000);
		const b = await credit(stores, "2026-11-05", 230_000);
		// O dono escolheu "Mercado" à mão na entrada de novembro.
		await stores.transactions.update(b.id, { categoryId: mercado, categoryEditedByOwner: true });
		expect(await categorizeSalaryCredits(stores, TODAY)).toBe(1);
		expect((await stores.transactions.get(a.id))?.categoryId).toBe(salaryId);
		const kept = await stores.transactions.get(b.id);
		expect(kept?.categoryId).toBe(mercado);
		expect(kept?.categoryEditedByOwner).toBe(true);
	});

	it("o dono que tirou a categoria à mão (flag ligada, sem categoria) também não é sobrescrito", async () => {
		const a = await credit(stores, "2026-10-05", 230_000);
		await credit(stores, "2026-11-05", 230_000);
		await stores.transactions.update(a.id, { categoryId: null, categoryEditedByOwner: true });
		expect(await categorizeSalaryCredits(stores, TODAY)).toBe(1);
		expect((await stores.transactions.get(a.id))?.categoryId).toBeNull();
	});

	it("entrada única sem renda cadastrada fica como está", async () => {
		const a = await credit(stores, "2026-11-05", 230_000);
		expect(await categorizeSalaryCredits(stores, TODAY)).toBe(0);
		expect((await stores.transactions.get(a.id))?.categoryId).toBeNull();
	});

	it("entrada única que bate com a renda cadastrada (valor e dia) vira Salário", async () => {
		await stores.incomeSources.create({ name: "Salário", amountCents: 230_000, payday: 5 });
		const a = await credit(stores, "2026-11-05", 230_000);
		const other = await credit(stores, "2026-11-06", 12_345, "Pix recebido Fulano");
		expect(await categorizeSalaryCredits(stores, TODAY)).toBe(1);
		expect((await stores.transactions.get(a.id))?.categoryId).toBe(salaryId);
		expect((await stores.transactions.get(other.id))?.categoryId).toBeNull();
	});

	it("só entrada: gasto de mesmo valor e pagador nunca é rotulado", async () => {
		const expense = await stores.transactions.create({
			kind: "expense",
			amountCents: 230_000,
			date: "2026-11-05",
			description: "Pix enviado Comércio De Ervas",
			accountId,
		});
		await stores.incomeSources.create({ name: "Salário", amountCents: 230_000, payday: 5 });
		await categorizeSalaryCredits(stores, TODAY);
		expect((await stores.transactions.get(expense.id))?.categoryId).toBeNull();
	});
});
