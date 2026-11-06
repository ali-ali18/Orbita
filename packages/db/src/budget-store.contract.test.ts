import { beforeEach, describe, expect, it } from "vitest";
import { contractSuites } from "./contract-harness.ts";
import type { Stores } from "./stores.ts";

describe.each(contractSuites())("BudgetStore (%s)", (_name, make) => {
	let stores: Stores;
	beforeEach(async () => {
		stores = await make();
	});

	it("define o total e por categoria, e troca o limite sem duplicar", async () => {
		const food = await stores.categories.create({ slug: "mercado", name: "Mercado" });
		await stores.budgets.set("total", 500_000);
		await stores.budgets.set(food.id, 120_000);
		const changed = await stores.budgets.set("total", 600_000);
		expect(changed).toMatchObject({ scope: "total", limitCents: 600_000 });
		expect((await stores.budgets.list()).map((b) => [b.scope, b.limitCents])).toEqual([
			["total", 600_000],
			[food.id, 120_000],
		]);
	});

	it("aceita limite zero e remove", async () => {
		await stores.budgets.set("total", 0);
		expect(await stores.budgets.remove("total")).toBe(true);
		expect(await stores.budgets.remove("total")).toBe(false);
		expect(await stores.budgets.list()).toEqual([]);
	});

	it("rejeita limite negativo/fracionário e categoria que não existe", async () => {
		await expect(stores.budgets.set("total", -1)).rejects.toMatchObject({
			code: "invalid",
			message: "O limite deve ser um inteiro de centavos, zero ou mais.",
		});
		await expect(stores.budgets.set("total", 10.5)).rejects.toMatchObject({ code: "invalid" });
		await expect(stores.budgets.set("categoria-fantasma", 100)).rejects.toMatchObject({
			code: "invalid",
			message: "O orçamento vale para o total ou para uma categoria que existe.",
		});
		expect(await stores.budgets.list()).toEqual([]);
	});
});
