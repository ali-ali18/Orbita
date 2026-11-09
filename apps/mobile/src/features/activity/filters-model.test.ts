import { describe, expect, it, vi } from "vitest";
import {
	type ActivityFilters,
	activeFilterCount,
	applyLabel,
	EMPTY_FILTERS,
	filterTags,
	hasErrors,
	maskBrDate,
	parseBrDate,
	parseReais,
	periodRange,
	pruneUnknown,
	removeTag,
	toBrDate,
	toggleItem,
	toQueryParams,
	validateFilters,
} from "./filters-model.ts";
import { createFiltersStore } from "./filters-store.ts";

const TODAY = "2026-11-15";
const f = (extra: Partial<ActivityFilters>): ActivityFilters => ({ ...EMPTY_FILTERS, ...extra });
const names = {
	accounts: new Map([["a1", { name: "Nubank" }]]),
	cards: new Map([["c1", { name: "Inter" }]]),
	categories: new Map([["k1", { name: "Mercado" }]]),
};

describe("parseReais", () => {
	it.each([
		["12,50", 1250],
		["12,5", 1250],
		["12", 1200],
		["0,99", 99],
		["R$ 1.234,56", 123456],
		["1.234", 123400],
		["12.5", 1250],
		["12.50", 1250],
		["  7 ", 700],
		["0", 0],
		["21474836,47", 2147483647],
	])("%s vira %i centavos", (text, cents) => {
		expect(parseReais(text)).toBe(cents);
	});

	it.each([[""], ["  "], ["R$"]])("vazio (%j) é null", (text) => {
		expect(parseReais(text)).toBeNull();
	});

	it.each([
		["abc"],
		["12,345"],
		["1,2,3"],
		["-5"],
		["12,"],
		[",5"],
		["1.23.4"],
		["21474836,48"],
		["99999999999999"],
	])("%s é inválido", (text) => {
		expect(parseReais(text)).toBe("invalid");
	});

	it("não perde centavo com valores que dão dízima em float", () => {
		expect(parseReais("0,29")).toBe(29);
		expect(parseReais("1.005,10")).toBe(100510);
		expect(parseReais("19,99")).toBe(1999);
	});
});

describe("datas digitadas", () => {
	it("parseBrDate valida o calendário", () => {
		expect(parseBrDate("12/11/2026")).toBe("2026-11-12");
		expect(parseBrDate("29/02/2024")).toBe("2024-02-29");
		expect(parseBrDate("29/02/2026")).toBeNull();
		expect(parseBrDate("31/04/2026")).toBeNull();
		expect(parseBrDate("2026-11-12")).toBeNull();
		expect(parseBrDate("")).toBeNull();
	});

	it("maskBrDate põe as barras enquanto digita", () => {
		expect(maskBrDate("1")).toBe("1");
		expect(maskBrDate("121")).toBe("12/1");
		expect(maskBrDate("12112026")).toBe("12/11/2026");
		expect(maskBrDate("12/11/20269999")).toBe("12/11/2026");
		expect(maskBrDate("ab12")).toBe("12");
	});

	it("toBrDate é o inverso", () => {
		expect(toBrDate("2026-01-05")).toBe("05/01/2026");
	});
});

describe("periodRange", () => {
	it("este mês: do dia 1 ao último dia", () => {
		expect(periodRange("this-month", TODAY)).toEqual({ from: "2026-11-01", to: "2026-11-30" });
		expect(periodRange("this-month", "2024-02-10")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
	});
	it("mês passado, inclusive virando o ano", () => {
		expect(periodRange("last-month", TODAY)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
		expect(periodRange("last-month", "2026-01-20")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
	});
	it("3 meses = 90 dias terminando hoje", () => {
		expect(periodRange("last-90-days", TODAY)).toEqual({ from: "2026-08-18", to: "2026-11-15" });
	});
});

describe("validateFilters", () => {
	it("filtro vazio e filtros completos válidos não têm erro", () => {
		expect(validateFilters(EMPTY_FILTERS)).toEqual({});
		expect(
			hasErrors(
				validateFilters(f({ period: "custom", from: "01/11/2026", to: "15/11/2026", min: "1", max: "9,90" })),
			),
		).toBe(false);
	});
	it("datas só importam no período personalizado", () => {
		expect(validateFilters(f({ period: "this-month", from: "lixo" }))).toEqual({});
		expect(validateFilters(f({ period: "custom", from: "32/01/2026" })).from).toMatch(/dd\/mm\/aaaa/);
		expect(validateFilters(f({ period: "custom", to: "1/1/2026" })).to).toMatch(/dd\/mm\/aaaa/);
	});
	it("data final antes da inicial", () => {
		expect(validateFilters(f({ period: "custom", from: "10/11/2026", to: "01/11/2026" })).to).toMatch(
			/depois/,
		);
		expect(validateFilters(f({ period: "custom", from: "10/11/2026", to: "10/11/2026" }))).toEqual({});
	});
	it("valores inválidos e faixa invertida", () => {
		expect(validateFilters(f({ min: "abc" })).min).toMatch(/reais/);
		expect(validateFilters(f({ max: "1,234" })).max).toMatch(/reais/);
		expect(validateFilters(f({ min: "50", max: "10" })).max).toMatch(/maior/);
		expect(validateFilters(f({ min: "10", max: "10" }))).toEqual({});
		expect(validateFilters(f({ min: "0", max: "5" }))).toEqual({});
	});
});

describe("toQueryParams", () => {
	it("sem filtro, sem parâmetro", () => {
		expect(toQueryParams(EMPTY_FILTERS, TODAY)).toEqual({});
	});

	it("traduz cada filtro para o formato da API (centavos inteiros)", () => {
		const params = toQueryParams(
			f({
				period: "last-month",
				types: ["in", "out"],
				accountIds: ["a1", "a2"],
				cardIds: ["c1"],
				categoryIds: ["k1"],
				sources: ["pluggy", "manual"],
				statuses: ["pending"],
				min: "10",
				max: "1.234,56",
			}),
			TODAY,
		);
		expect(params).toEqual({
			from: "2026-10-01",
			to: "2026-10-31",
			// Segue a ordem da gaveta (Saídas, Entradas), não a ordem do toque.
			kinds: "expense,income,refund",
			accountIds: "a1,a2",
			cardIds: "c1",
			categoryIds: "k1",
			sources: "pluggy,manual",
			statuses: "pending",
			minCents: "1000",
			maxCents: "123456",
		});
	});

	it("investimentos filtra a aplicação e o resgate, à parte das saídas", () => {
		expect(toQueryParams(f({ types: ["invest"] }), TODAY).kinds).toBe("investment,redemption");
		expect(toQueryParams(f({ types: ["out"] }), TODAY).kinds).toBe("expense");
	});

	it("transferência inclui pagamento de fatura", () => {
		expect(toQueryParams(f({ types: ["transfer"] }), TODAY).kinds).toBe("transfer,card_payment");
	});

	it("período personalizado com uma ponta só", () => {
		expect(toQueryParams(f({ period: "custom", from: "01/11/2026" }), TODAY)).toEqual({ from: "2026-11-01" });
		expect(toQueryParams(f({ period: "custom", to: "15/11/2026" }), TODAY)).toEqual({ to: "2026-11-15" });
		expect(toQueryParams(f({ period: "custom" }), TODAY)).toEqual({});
	});

	it("ignora campo inválido em vez de mandar lixo", () => {
		expect(toQueryParams(f({ period: "custom", from: "99/99/9999", min: "x" }), TODAY)).toEqual({});
	});

	it("zero é um limite válido (mínimo 0 não some)", () => {
		expect(toQueryParams(f({ min: "0", max: "0" }), TODAY)).toEqual({ minCents: "0", maxCents: "0" });
	});

	it("o resultado nunca passa de 50 ids por lista", () => {
		const ids = Array.from({ length: 80 }, (_, i) => `id${i}`);
		expect(toQueryParams(f({ categoryIds: ids }), TODAY).categoryIds?.split(",")).toHaveLength(50);
	});
});

describe("contagem e etiquetas", () => {
	it("o selo conta grupos, não itens", () => {
		expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
		expect(activeFilterCount(f({ types: ["in", "out"], categoryIds: ["a", "b", "c"] }))).toBe(2);
		expect(activeFilterCount(f({ accountIds: ["a1"], cardIds: ["c1"] }))).toBe(1);
		expect(activeFilterCount(f({ min: "5" }))).toBe(1);
		expect(activeFilterCount(f({ min: "5", max: "9" }))).toBe(1);
		expect(
			activeFilterCount(
				f({
					period: "this-month",
					types: ["out"],
					accountIds: ["a"],
					categoryIds: ["k"],
					max: "1",
					sources: ["manual"],
					statuses: ["pending"],
				}),
			),
		).toBe(7);
	});

	it("uma etiqueta por item, na ordem da gaveta", () => {
		const tags = filterTags(
			f({
				period: "custom",
				from: "01/11/2026",
				to: "15/11/2026",
				types: ["transfer", "out"],
				accountIds: ["a1"],
				cardIds: ["c1"],
				categoryIds: ["k1", "gone"],
				min: "10",
				max: "20,5",
				sources: ["receipt"],
				statuses: ["confirmed"],
			}),
			names,
		);
		expect(tags.map((t) => t.label)).toEqual([
			"01/11/2026 a 15/11/2026",
			"Saídas",
			"Transferências",
			"Nubank",
			"Inter",
			"Mercado",
			"Categoria",
			"R$ 10,00 a R$ 20,50",
			"Comprovante",
			"Confirmado",
		]);
		expect(new Set(tags.map((t) => t.key)).size).toBe(tags.length);
	});

	it("rótulos de faixa aberta", () => {
		expect(filterTags(f({ min: "5" }), names)[0]?.label).toBe("A partir de R$ 5,00");
		expect(filterTags(f({ max: "5" }), names)[0]?.label).toBe("Até R$ 5,00");
	});

	it("removeTag tira só o item da etiqueta e é o inverso de filterTags", () => {
		const all = f({
			period: "this-month",
			types: ["out", "in"],
			accountIds: ["a1"],
			cardIds: ["c1"],
			categoryIds: ["k1"],
			min: "1",
			sources: ["manual"],
			statuses: ["pending"],
		});
		let state = all;
		for (const tag of filterTags(all, names)) state = removeTag(state, tag.key);
		expect(state).toEqual(EMPTY_FILTERS);
		expect(removeTag(all, "type:out").types).toEqual(["in"]);
		expect(removeTag(all, "value")).toMatchObject({ min: "", max: "" });
		expect(removeTag(f({ period: "custom", from: "01/01/2026" }), "period")).toEqual(EMPTY_FILTERS);
		expect(removeTag(all, "nada:x")).toBe(all);
	});

	it("toggleItem liga e desliga", () => {
		expect(toggleItem(["a"], "b")).toEqual(["a", "b"]);
		expect(toggleItem(["a", "b"], "a")).toEqual(["b"]);
	});

	it("pruneUnknown tira ids que não existem mais e preserva a referência quando nada muda", () => {
		const known = { accounts: new Set(["a1"]), cards: new Set(["c1"]), categories: new Set(["k1"]) };
		const same = f({ accountIds: ["a1"], cardIds: ["c1"], categoryIds: ["k1"] });
		expect(pruneUnknown(same, known)).toBe(same);
		expect(pruneUnknown(f({ accountIds: ["a1", "x"], categoryIds: ["y"] }), known)).toMatchObject({
			accountIds: ["a1"],
			categoryIds: [],
		});
	});

	it("applyLabel", () => {
		expect(applyLabel(null)).toBe("Ver lançamentos");
		expect(applyLabel(0)).toBe("Nenhum lançamento");
		expect(applyLabel(1)).toBe("Ver 1 lançamento");
		expect(applyLabel(42)).toBe("Ver 42 lançamentos");
	});
});

describe("createFiltersStore", () => {
	it("guarda, avisa quem assina e ignora o mesmo valor", () => {
		const store = createFiltersStore();
		const listener = vi.fn();
		const off = store.subscribe(listener);
		expect(store.get()).toBe(EMPTY_FILTERS);
		const next = f({ types: ["out"] });
		store.set(next);
		store.set(next);
		expect(store.get()).toBe(next);
		expect(listener).toHaveBeenCalledTimes(1);
		off();
		store.set(EMPTY_FILTERS);
		expect(listener).toHaveBeenCalledTimes(1);
	});
});
