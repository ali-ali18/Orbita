import { describe, expect, it } from "vitest";
import {
	DEFAULT_HOME_LAYOUT,
	defaultHomeLayout,
	HOME_WIDGET_IDS,
	HOME_WIDGETS,
	type HomeLayout,
	homeLayoutBody,
	homeLayoutProblem,
	homeRows,
	moveWidget,
	reconcileHomeLayout,
	setWidgetSize,
	setWidgetVisible,
} from "./home-layout.ts";

const ids = (l: HomeLayout) => l.map((i) => i.id);
const shown = (l: HomeLayout) => l.filter((i) => i.visible).map((i) => i.id);

describe("catálogo e padrão", () => {
	it("todo widget tem tamanho padrão que ele aceita e ao menos um tamanho", () => {
		for (const id of HOME_WIDGET_IDS) {
			const def = HOME_WIDGETS[id];
			expect(def.sizes.length).toBeGreaterThan(0);
			expect(def.sizes).toContain(def.defaultSize);
		}
	});

	it("o padrão é enxuto, completo e válido", () => {
		expect(shown([...DEFAULT_HOME_LAYOUT])).toEqual([
			"hero",
			"wallet",
			"balance",
			"limit",
			"categories",
			"recent",
		]);
		expect(ids([...DEFAULT_HOME_LAYOUT]).sort()).toEqual([...HOME_WIDGET_IDS].sort());
		expect(homeLayoutProblem(DEFAULT_HOME_LAYOUT)).toBeNull();
		const firstHidden = DEFAULT_HOME_LAYOUT.findIndex((i) => !i.visible);
		expect(DEFAULT_HOME_LAYOUT.slice(firstHidden).every((i) => !i.visible)).toBe(true);
	});

	it("defaultHomeLayout devolve uma cópia", () => {
		const a = defaultHomeLayout();
		(a[0] as { size: string }).size = "2x4";
		expect(defaultHomeLayout()[0]?.size).toBe("4x4");
	});
});

describe("validação", () => {
	it("recusa id repetido e tamanho que o widget não tem", () => {
		expect(
			homeLayoutProblem([
				{ id: "hero", size: "4x4", visible: true },
				{ id: "hero", size: "4x4", visible: true },
			]),
		).toBe("Widget repetido.");
		expect(homeLayoutProblem([{ id: "report", size: "2x2", visible: true }])).toBe(
			"Relatório do mês não tem o tamanho 2x2.",
		);
	});

	it("o corpo do PUT recusa id desconhecido, tamanho desconhecido e campo extra", () => {
		const parse = (items: unknown[]) => homeLayoutBody.safeParse({ items });
		expect(parse([{ id: "x", size: "2x2", visible: true }]).success).toBe(false);
		expect(parse([{ id: "hero", size: "9x9", visible: true }]).success).toBe(false);
		expect(parse([{ id: "hero", size: "4x4", visible: true, extra: 1 }]).success).toBe(false);
		expect(parse([{ id: "hero", size: "4x4", visible: true }]).success).toBe(true);
		const bad = parse([{ id: "report", size: "4x4", visible: true }]);
		expect(bad.success ? "" : bad.error.issues[0]?.message).toBe("Relatório do mês não tem o tamanho 4x4.");
	});
});

describe("reconcileHomeLayout (catálogo que cresce)", () => {
	it("sem nada guardado, vale o padrão", () => {
		expect(reconcileHomeLayout(null)).toEqual(defaultHomeLayout());
	});

	it("widget novo entra oculto no fim, no tamanho padrão", () => {
		const stored = [
			{ id: "recent", size: "2x4", visible: true },
			{ id: "hero", size: "2x4", visible: true },
		];
		const out = reconcileHomeLayout(stored);
		expect(out.slice(0, 2)).toEqual(stored);
		expect(out).toHaveLength(HOME_WIDGET_IDS.length);
		expect(out.slice(2).every((i) => !i.visible && i.size === HOME_WIDGETS[i.id].defaultSize)).toBe(true);
	});

	it("descarta id que saiu do catálogo, repetido e lixo; corrige tamanho que não existe mais", () => {
		const out = reconcileHomeLayout([
			{ id: "antigo", size: "2x2", visible: true },
			{ id: "hero", size: "2x2", visible: true },
			{ id: "hero", size: "4x4", visible: true },
			null,
			"texto",
		]);
		expect(out.filter((i) => i.id === "hero")).toEqual([{ id: "hero", size: "4x4", visible: true }]);
		expect(ids(out)).not.toContain("antigo");
		expect(homeLayoutProblem(out)).toBeNull();
	});

	it("visíveis ficam antes dos ocultos, sem mudar a ordem entre eles", () => {
		const out = reconcileHomeLayout([
			{ id: "limit", size: "2x2", visible: false },
			{ id: "recent", size: "4x4", visible: true },
			{ id: "hero", size: "4x4", visible: true },
		]);
		expect(shown(out)).toEqual(["recent", "hero"]);
		expect(ids(out).slice(0, 3)).toEqual(["recent", "hero", "limit"]);
	});
});

describe("edição", () => {
	const base = defaultHomeLayout();

	it("tamanho: só os que o widget aceita", () => {
		expect(setWidgetSize(base, "hero", "2x4").find((i) => i.id === "hero")?.size).toBe("2x4");
		expect(setWidgetSize(base, "hero", "2x2")).toBe(base);
	});

	it("ocultar manda para o fim; mostrar entra depois do último visível", () => {
		const hidden = setWidgetVisible(base, "wallet", false);
		expect(shown(hidden)).toEqual(["hero", "balance", "limit", "categories", "recent"]);
		expect(ids(hidden).at(-1)).toBe("wallet");
		const back = setWidgetVisible(hidden, "report", true);
		expect(shown(back)).toEqual(["hero", "balance", "limit", "categories", "recent", "report"]);
		expect(homeLayoutProblem(back)).toBeNull();
		expect(setWidgetVisible(base, "hero", true)).toBe(base);
	});

	it("subir e descer só entre os visíveis, e nas pontas nada muda", () => {
		expect(shown(moveWidget(base, "limit", -1))).toEqual([
			"hero",
			"wallet",
			"limit",
			"balance",
			"categories",
			"recent",
		]);
		expect(shown(moveWidget(base, "hero", 1))).toEqual([
			"wallet",
			"hero",
			"balance",
			"limit",
			"categories",
			"recent",
		]);
		expect(moveWidget(base, "hero", -1)).toBe(base);
		expect(moveWidget(base, "recent", 1)).toBe(base);
		expect(moveWidget(base, "report", -1)).toBe(base);
	});
});

describe("grade", () => {
	const item = (id: HomeLayout[number]["id"], size: HomeLayout[number]["size"], visible = true) => ({
		id,
		size,
		visible,
	});

	it("dois 2x2 seguidos se emparelham; o resto ocupa a largura", () => {
		const rows = homeRows(defaultHomeLayout());
		expect(rows.map((r) => (r.kind === "full" ? r.item.id : r.items.map((i) => i.id).join("+")))).toEqual([
			"hero",
			"wallet",
			"balance+limit",
			"categories",
			"recent",
		]);
	});

	it("2x2 sozinho fica em meia largura na própria linha", () => {
		const rows = homeRows([item("balance", "2x2"), item("hero", "4x4"), item("limit", "2x2")]);
		expect(rows.map((r) => r.kind)).toEqual(["pair", "full", "pair"]);
		expect(rows.map((r) => (r.kind === "pair" ? r.items.length : 1))).toEqual([1, 1, 1]);
	});

	it("três 2x2 viram um par e um sozinho; ocultos não entram; 2x4 e 4x4 são largura cheia", () => {
		const rows = homeRows([
			item("balance", "2x2"),
			item("limit", "2x2"),
			item("cashflow", "2x2"),
			item("report", "2x4", false),
			item("recent", "2x4"),
		]);
		expect(rows.map((r) => (r.kind === "pair" ? r.items.length : "full"))).toEqual([2, 1, "full"]);
	});

	it("sem nada visível, sem linhas", () => {
		expect(homeRows([item("hero", "4x4", false)])).toEqual([]);
	});
});
