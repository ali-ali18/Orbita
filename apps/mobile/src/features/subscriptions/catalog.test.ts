import { describe, expect, it } from "vitest";
import {
	categoryIdByName,
	featuredServices,
	SERVICE_CATALOG,
	searchServices,
	serviceByName,
} from "./catalog.ts";

describe("catálogo de serviços", () => {
	it("traz os serviços comuns do Brasil, sem repetir id nem nome", () => {
		const names = SERVICE_CATALOG.map((s) => s.name);
		for (const name of [
			"Netflix",
			"Spotify",
			"Disney+",
			"Max",
			"Prime Video",
			"YouTube Premium",
			"Apple",
			"iCloud",
			"Google One",
			"Globoplay",
			"Deezer",
			"Academia",
		]) {
			expect(names).toContain(name);
		}
		expect(new Set(SERVICE_CATALOG.map((s) => s.id)).size).toBe(SERVICE_CATALOG.length);
		expect(new Set(names).size).toBe(names.length);
	});

	it("não sugere valor: o catálogo só tem nome e categoria", () => {
		for (const service of SERVICE_CATALOG) {
			expect(Object.keys(service).some((k) => /amount|cents|price|valor/i.test(k))).toBe(false);
		}
	});

	it("a grade de atalhos segue a ordem do Figma, com os nomes curtos", () => {
		expect(featuredServices().map((s) => s.shortName ?? s.name)).toEqual([
			"Netflix",
			"Spotify",
			"YouTube",
			"Google One",
			"Prime",
			"Disney+",
			"iCloud",
		]);
	});

	it("academia é Saúde; o resto é Assinaturas", () => {
		expect(serviceByName("academia")?.category).toBe("Saúde");
		expect(serviceByName("Netflix")?.category).toBe("Assinaturas");
	});
});

describe("buscar serviço", () => {
	it("acha pelo começo do nome, sem olhar caixa nem acento", () => {
		expect(searchServices("net").map((s) => s.name)).toEqual(["Netflix"]);
		expect(searchServices("GLOBO").map((s) => s.name)).toEqual(["Globoplay"]);
		expect(searchServices("saude")).toEqual([]);
	});

	it("acha por apelido e põe quem começa com o texto antes de quem só contém", () => {
		expect(searchServices("hbo").map((s) => s.name)).toEqual(["Max"]);
		expect(searchServices("smart")[0]?.name).toBe("Academia");
		expect(searchServices("pri").map((s) => s.name)).toEqual(["Prime Video"]);
		expect(searchServices("e").map((s) => s.name)[0]).toBe("Netflix");
	});

	it("texto vazio ou sem resultado não sugere nada; respeita o limite", () => {
		expect(searchServices("")).toEqual([]);
		expect(searchServices("   ")).toEqual([]);
		expect(searchServices("zzzz")).toEqual([]);
		expect(searchServices("a", SERVICE_CATALOG, 3)).toHaveLength(3);
	});

	it("serviceByName só casa o nome inteiro", () => {
		expect(serviceByName(" disney+ ")?.id).toBe("disney-plus");
		expect(serviceByName("Disney")).toBeUndefined();
		expect(serviceByName("")).toBeUndefined();
	});
});

describe("categoria do serviço", () => {
	const cats = [
		{ id: "1", name: "Saúde", archivedAt: null },
		{ id: "2", name: "Assinaturas", archivedAt: "2026-01-01T00:00:00.000Z" },
		{ id: "3", name: "ASSINATURAS", archivedAt: null },
	];

	it("acha a categoria ativa do dono pelo nome, sem acento nem caixa", () => {
		expect(categoryIdByName(cats, "saude")).toBe("1");
		expect(categoryIdByName(cats, "Assinaturas")).toBe("3");
		expect(categoryIdByName(cats, "Lazer")).toBeNull();
	});
});
