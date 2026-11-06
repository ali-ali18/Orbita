import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "./category-store.ts";
import { contractSuites } from "./contract-harness.ts";
import type { Stores } from "./stores.ts";

describe.each(contractSuites())("CategoryStore (%s)", (_name, make) => {
	let stores: Stores;
	beforeEach(async () => {
		stores = await make();
	});

	it("cria, busca por id e por slug", async () => {
		const c = await stores.categories.create({ slug: "pets", name: "Pets", chartSlot: 2 });
		expect(c).toMatchObject({ slug: "pets", chartSlot: 2, isSystem: false, archivedAt: null });
		expect(await stores.categories.get(c.id)).toEqual(c);
		expect(await stores.categories.getBySlug("pets")).toEqual(c);
		expect(await stores.categories.getBySlug("nada")).toBeNull();
	});

	it("slug repetido é duplicate; slug e espaço no gráfico inválidos são invalid", async () => {
		await stores.categories.create({ slug: "pets", name: "Pets" });
		await expect(stores.categories.create({ slug: "pets", name: "Outro" })).rejects.toMatchObject({
			code: "duplicate",
			message: "Já existe uma categoria com este identificador.",
		});
		await expect(stores.categories.create({ slug: "Pets Legais", name: "X" })).rejects.toMatchObject({
			code: "invalid",
			message: "O identificador da categoria usa letras minúsculas, números e hífen.",
		});
		await expect(stores.categories.create({ slug: "a", name: "X", chartSlot: 5 })).rejects.toMatchObject({
			code: "invalid",
			message: "O espaço no gráfico vai de 0 a 4.",
		});
	});

	it("atualiza nome e espaço no gráfico; o slug não muda", async () => {
		const c = await stores.categories.create({ slug: "pets", name: "Pets", chartSlot: 1 });
		const u = await stores.categories.update(c.id, { name: "Bichos", chartSlot: null });
		expect(u).toMatchObject({ slug: "pets", name: "Bichos", chartSlot: null });
	});

	it("arquiva (some da lista, segue no get) mas não arquiva categoria do sistema", async () => {
		await stores.categories.ensureDefaults();
		const pets = await stores.categories.create({ slug: "pets", name: "Pets" });
		await stores.categories.archive(pets.id);
		expect((await stores.categories.list()).map((c) => c.slug)).not.toContain("pets");
		expect((await stores.categories.get(pets.id))?.archivedAt).toBeInstanceOf(Date);
		const outros = await stores.categories.getBySlug("outros");
		await expect(stores.categories.archive(outros?.id ?? "")).rejects.toMatchObject({
			code: "invalid",
			message: "Categoria do sistema não pode ser arquivada.",
		});
	});

	it("ensureDefaults cria as padrão uma vez só e respeita o que o usuário mudou", async () => {
		await stores.categories.ensureDefaults();
		await stores.categories.ensureDefaults();
		const list = await stores.categories.list();
		expect(list.map((c) => c.slug)).toEqual(DEFAULT_CATEGORIES.map((c) => c.slug));
		expect(list.map((c) => [c.slug, c.chartSlot, c.isSystem])).toEqual([
			["mercado", 0, false],
			["delivery", 1, false],
			["transporte", 2, false],
			["assinaturas", 3, false],
			["lazer", 4, false],
			["moradia", null, false],
			["saude", null, false],
			["transferencias", null, true],
			["outros", null, true],
		]);
		const mercado = list[0];
		await stores.categories.update(mercado?.id ?? "", { name: "Supermercado", chartSlot: 3 });
		await stores.categories.ensureDefaults();
		expect(await stores.categories.getBySlug("mercado")).toMatchObject({
			name: "Supermercado",
			chartSlot: 3,
		});
		expect(await stores.categories.list()).toHaveLength(9);
	});

	it("ensureDefaults não recria a que o usuário arquivou", async () => {
		await stores.categories.ensureDefaults();
		const lazer = await stores.categories.getBySlug("lazer");
		await stores.categories.archive(lazer?.id ?? "");
		await stores.categories.ensureDefaults();
		expect((await stores.categories.list()).map((c) => c.slug)).not.toContain("lazer");
		expect((await stores.categories.getBySlug("lazer"))?.archivedAt).not.toBeNull();
	});
});
