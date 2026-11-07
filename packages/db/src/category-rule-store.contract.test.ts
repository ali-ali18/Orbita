import { beforeEach, describe, expect, it } from "vitest";
import { contractSuites, seedBasics } from "./contract-harness.ts";
import type { Stores } from "./stores.ts";

describe.each(contractSuites())("CategoryRuleStore (%s)", (_name, make) => {
	let stores: Stores;
	let b: Awaited<ReturnType<typeof seedBasics>>;
	beforeEach(async () => {
		stores = await make();
		b = await seedBasics(stores);
	});

	it("cria, lista (mais antigas primeiro), busca e apaga", async () => {
		const a = await stores.categoryRules.upsert("rei dos lanches", b.food.id);
		const c = await stores.categoryRules.upsert("uber", b.food.id);
		expect(a).toMatchObject({ pattern: "rei dos lanches", categoryId: b.food.id });
		expect((await stores.categoryRules.list()).map((r) => r.pattern)).toEqual(["rei dos lanches", "uber"]);
		expect(await stores.categoryRules.get(c.id)).toEqual(c);
		expect(await stores.categoryRules.get("nada")).toBeNull();
		expect(await stores.categoryRules.delete(a.id)).toBe(true);
		expect(await stores.categoryRules.delete(a.id)).toBe(false);
		expect((await stores.categoryRules.list()).map((r) => r.pattern)).toEqual(["uber"]);
	});

	it("o mesmo padrão troca a categoria da regra existente (mesma id)", async () => {
		const other = await stores.categories.create({ slug: "pets", name: "Pets" });
		const first = await stores.categoryRules.upsert("petz", b.food.id);
		const again = await stores.categoryRules.upsert("petz", other.id);
		expect(again.id).toBe(first.id);
		expect(again.categoryId).toBe(other.id);
		expect(await stores.categoryRules.list()).toHaveLength(1);
	});

	it("recusa padrão fora da forma normalizada ou curto demais", async () => {
		await expect(stores.categoryRules.upsert("Rei Dos Lanches", b.food.id)).rejects.toMatchObject({
			code: "invalid",
		});
		await expect(stores.categoryRules.upsert("ab", b.food.id)).rejects.toMatchObject({ code: "invalid" });
		await expect(stores.categoryRules.upsert("pix enviado", b.food.id)).rejects.toMatchObject({
			code: "invalid",
		});
	});

	it("categoria inexistente ou arquivada é bad_reference", async () => {
		await expect(stores.categoryRules.upsert("uber", "nao-existe")).rejects.toMatchObject({
			code: "bad_reference",
		});
		const pets = await stores.categories.create({ slug: "pets", name: "Pets" });
		await stores.categories.archive(pets.id);
		await expect(stores.categoryRules.upsert("uber", pets.id)).rejects.toMatchObject({
			code: "bad_reference",
		});
	});
});
