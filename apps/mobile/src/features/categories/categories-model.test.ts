import { describe, expect, it } from "vitest";
import {
	checkName,
	isAffectedByCategories,
	nextFreeSlot,
	ruleRows,
	slugify,
	uniqueSlug,
} from "./categories-model.ts";

const cat = (id: string, name: string, chartSlot: number | null = null) => ({
	id,
	slug: id,
	name,
	chartSlot,
	isSystem: false,
});

describe("slugify", () => {
	it("tira acento, símbolos e espaços", () => {
		expect(slugify("Café & Pão")).toBe("cafe-pao");
		expect(slugify("  Saúde  ")).toBe("saude");
	});
	it("limita a 40 letras sem hífen na ponta", () => {
		const slug = slugify(`${"a".repeat(39)} b`);
		expect(slug.length).toBeLessThanOrEqual(40);
		expect(slug.endsWith("-")).toBe(false);
	});
	it("nome sem letras dá vazio", () => {
		expect(slugify("!!!")).toBe("");
	});
});

describe("uniqueSlug", () => {
	it("usa o slug puro quando está livre", () => {
		expect(uniqueSlug("Viagem", ["lazer"])).toBe("viagem");
	});
	it("acrescenta número quando já existe", () => {
		expect(uniqueSlug("Viagem", ["viagem", "viagem-2"])).toBe("viagem-3");
	});
	it("nome sem letras vira 'categoria'", () => {
		expect(uniqueSlug("???", [])).toBe("categoria");
	});
	it("respeita o limite de 40 com o sufixo", () => {
		const long = "a".repeat(40);
		expect(uniqueSlug(long, [long]).length).toBeLessThanOrEqual(40);
	});
});

describe("checkName", () => {
	it("limpa espaços", () => {
		expect(checkName("  Pet   shop ", [])).toEqual({ ok: true, name: "Pet shop" });
	});
	it("recusa vazio, longo e repetido (sem diferenciar caixa)", () => {
		expect(checkName("  ", [])).toMatchObject({ ok: false });
		expect(checkName("x".repeat(61), [])).toMatchObject({ ok: false });
		expect(checkName("mercado", ["Mercado"])).toEqual({
			ok: false,
			message: "Já existe uma categoria com esse nome.",
		});
	});
});

describe("nextFreeSlot", () => {
	it("pega a primeira cor sem uso", () => {
		expect(nextFreeSlot([{ chartSlot: 0 }, { chartSlot: 1 }, { chartSlot: null }])).toBe(2);
	});
	it("com tudo em uso, pega a menos repetida", () => {
		const all = Array.from({ length: 10 }, (_, i) => ({ chartSlot: i }));
		expect(nextFreeSlot([...all, { chartSlot: 0 }])).toBe(1);
	});
});

describe("ruleRows", () => {
	it("ordena da mais nova e nomeia a categoria", () => {
		const rows = ruleRows(
			[
				{ id: "r1", pattern: "uber", categoryId: "c1", createdAt: "2026-11-02T10:00:00.000Z" },
				{ id: "r2", pattern: "ifood", categoryId: "gone", createdAt: "2026-11-05T10:00:00.000Z" },
			],
			[cat("c1", "Transporte")],
		);
		expect(rows.map((r) => r.id)).toEqual(["r2", "r1"]);
		expect(rows[0]?.title).toBe("ifood → Categoria removida");
		expect(rows[1]).toMatchObject({ title: "uber → Transporte", caption: "Criada em 2 de nov" });
	});
});

describe("isAffectedByCategories", () => {
	it("só olha o servidor atual e os assuntos ligados", () => {
		expect(isAffectedByCategories(["s", "categories"], "s")).toBe(true);
		expect(isAffectedByCategories(["s", "budgets"], "s")).toBe(true);
		expect(isAffectedByCategories(["s", "accounts"], "s")).toBe(false);
		expect(isAffectedByCategories(["o", "categories"], "s")).toBe(false);
	});
});
