import {
	defaultHomeLayout,
	HOME_WIDGET_IDS,
	moveWidget,
	setWidgetSize,
	setWidgetVisible,
} from "@orbita/shared";
import { describe, expect, it } from "vitest";
import {
	addableWidgets,
	type MenuViewport,
	placeWidgetMenu,
	revealScroll,
	WIDGET_DESCRIPTIONS,
	widgetMenuModel,
} from "./widget-menu-model.ts";

// Um celular de 390x844: barra de status de 56 e barra de gestos de 28.
const viewport: MenuViewport = { width: 390, height: 844, top: 56, bottom: 28 };
const menu = { width: 280, height: 300 };
const gap = 8;
const margin = 8;
const place = (anchor: { x: number; y: number; width: number; height: number }, v = viewport) =>
	placeWidgetMenu({ anchor, menu, viewport: v, gap, margin });

describe("placeWidgetMenu", () => {
	it("widget no topo: o menu abre colado embaixo, alinhado à esquerda dele", () => {
		const p = place({ x: 16, y: 120, width: 358, height: 220 });
		expect(p).toEqual({ side: "below", top: 348, left: 16, overlaps: false });
	});

	it("widget no fim da tela: o menu abre para cima", () => {
		const p = place({ x: 16, y: 560, width: 358, height: 220 });
		expect(p.side).toBe("above");
		expect(p.top).toBe(560 - gap - menu.height);
		expect(p.overlaps).toBe(false);
	});

	it("2x2 à direita: o menu encosta na borda direita do widget e não sai da tela", () => {
		const p = place({ x: 201, y: 200, width: 173, height: 150 });
		expect(p.left).toBe(201 + 173 - menu.width);
		expect(p.left + menu.width).toBeLessThanOrEqual(viewport.width - margin);
	});

	it("2x2 à esquerda: o menu começa na borda esquerda do widget", () => {
		expect(place({ x: 16, y: 200, width: 173, height: 150 }).left).toBe(16);
	});

	it("menu mais largo que a folga: fica dentro das margens", () => {
		const narrow = { ...viewport, width: 300 };
		const p = place({ x: 160, y: 200, width: 140, height: 150 }, narrow);
		expect(p.left).toBe(narrow.width - margin - menu.width);
		expect(place({ x: 0, y: 200, width: 100, height: 150 }, narrow).left).toBe(margin);
	});

	it("teclado ou barra inferior: o espaço de baixo encolhe e o menu vai para cima", () => {
		const anchor = { x: 16, y: 380, width: 358, height: 120 };
		expect(place(anchor).side).toBe("below");
		const withKeyboard = place(anchor, { ...viewport, bottom: 320 });
		expect(withKeyboard.side).toBe("above");
		expect(withKeyboard.top + menu.height).toBeLessThanOrEqual(380 - gap);
	});

	it("sem espaço em nenhum lado: vai para o lado maior, dentro da tela, e avisa que cobre o widget", () => {
		const p = place({ x: 16, y: 150, width: 358, height: 560 });
		expect(p.overlaps).toBe(true);
		expect(p.side).toBe("below");
		expect(p.top).toBe(viewport.height - viewport.bottom - margin - menu.height);
		const upper = place({ x: 16, y: 250, width: 358, height: 560 });
		expect(upper.side).toBe("above");
		expect(upper.top).toBe(viewport.top + margin);
	});
});

describe("revealScroll", () => {
	const reveal = (anchor: { x: number; y: number; width: number; height: number }, v = viewport) =>
		revealScroll({ anchor, menuHeight: menu.height, viewport: v, bottomBar: 96, gap, margin });

	it("widget inteiro e com lugar para o menu: não rola", () => {
		expect(reveal({ x: 16, y: 120, width: 358, height: 220 })).toBe(0);
		expect(reveal({ x: 16, y: 500, width: 358, height: 220 })).toBe(0);
	});

	it("widget cortado embaixo (atrás da barra): sobe até aparecer inteiro", () => {
		const dy = reveal({ x: 16, y: 700, width: 358, height: 220 });
		// Depois de rolar, o fim do widget encosta no topo da barra de baixo.
		expect(700 - dy + 220).toBe(viewport.height - 96 - margin);
	});

	it("widget cortado em cima: desce até passar da barra de status", () => {
		const dy = reveal({ x: 16, y: -40, width: 358, height: 220 });
		expect(dy).toBeLessThan(0);
		expect(-40 - dy).toBe(viewport.top + margin);
	});

	it("widget no meio, sem lugar para o menu: rola o mínimo para abrir espaço", () => {
		// 300 de altura em y=260: sobram 196 em cima e 240 embaixo (o menu precisa de 308).
		const anchor = { x: 16, y: 260, width: 358, height: 300 };
		const dy = reveal(anchor);
		const after = { ...anchor, y: anchor.y - dy };
		expect(place(after).overlaps).toBe(false);
		expect(Math.abs(dy)).toBeLessThanOrEqual(70);
	});

	it("widget mais alto que a área visível: alinha pelo topo", () => {
		const dy = reveal({ x: 16, y: 300, width: 358, height: 900 });
		expect(300 - dy).toBe(viewport.top + margin);
	});

	it("widget e menu não cabem juntos: só garante o widget inteiro", () => {
		const anchor = { x: 16, y: 400, width: 358, height: 560 };
		const dy = reveal(anchor);
		const y = anchor.y - dy;
		expect(y).toBeGreaterThanOrEqual(viewport.top + margin);
		expect(y + anchor.height).toBeLessThanOrEqual(viewport.height - 96 - margin);
	});
});

describe("widgetMenuModel", () => {
	const base = defaultHomeLayout();

	it("mostra só os tamanhos que o widget tem, com o atual marcado", () => {
		expect(widgetMenuModel(base, "hero")?.sizes).toEqual([
			{ size: "2x4", selected: false },
			{ size: "4x4", selected: true },
		]);
		expect(widgetMenuModel(base, "limit")?.sizes.map((s) => s.size)).toEqual(["2x2", "2x4", "4x4"]);
		const resized = setWidgetSize(base, "hero", "2x4");
		expect(widgetMenuModel(resized, "hero")?.sizes.find((s) => s.selected)?.size).toBe("2x4");
	});

	it("widget de tamanho único não oferece tamanho", () => {
		const withReport = setWidgetVisible(base, "report", true);
		expect(widgetMenuModel(withReport, "report")?.sizes).toEqual([]);
	});

	it("mover fica desabilitado nas pontas", () => {
		expect(widgetMenuModel(base, "hero")).toMatchObject({ canMoveUp: false, canMoveDown: true });
		expect(widgetMenuModel(base, "wallet")).toMatchObject({ canMoveUp: true, canMoveDown: true });
		expect(widgetMenuModel(base, "recent")).toMatchObject({ canMoveUp: true, canMoveDown: false });
		const moved = moveWidget(base, "recent", -1);
		expect(widgetMenuModel(moved, "recent")).toMatchObject({ canMoveUp: true, canMoveDown: true });
	});

	it("um widget só: nem sobe nem desce", () => {
		const one = base.map((i) => ({ ...i, visible: i.id === "hero" }));
		expect(widgetMenuModel(one, "hero")).toMatchObject({ canMoveUp: false, canMoveDown: false });
	});

	it("'Adicionar widgets' só quando há ocultos", () => {
		expect(widgetMenuModel(base, "hero")?.canAdd).toBe(true);
		const all = base.map((i) => ({ ...i, visible: true }));
		expect(widgetMenuModel(all, "hero")?.canAdd).toBe(false);
	});

	it("widget oculto ou nenhum: sem menu", () => {
		expect(widgetMenuModel(base, "report")).toBeNull();
		expect(widgetMenuModel(base, null)).toBeNull();
		// Remover pelo menu fecha: o widget deixa de ter menu.
		expect(widgetMenuModel(setWidgetVisible(base, "hero", false), "hero")).toBeNull();
	});
});

describe("addableWidgets", () => {
	it("lista só os ocultos, com nome, descrição e o tamanho em que voltam", () => {
		const list = addableWidgets(defaultHomeLayout());
		expect(list.map((w) => w.id)).toEqual(["cashflow", "installments", "subscriptions", "report"]);
		expect(list[0]).toEqual({
			id: "cashflow",
			label: "Fluxo de caixa",
			description: "Entradas e saídas do mês",
			size: "2x2",
		});
	});

	it("o que foi removido aparece na lista e some dela ao voltar", () => {
		const removed = setWidgetVisible(defaultHomeLayout(), "wallet", false);
		expect(addableWidgets(removed).map((w) => w.id)).toContain("wallet");
		const back = setWidgetVisible(removed, "wallet", true);
		expect(addableWidgets(back).map((w) => w.id)).not.toContain("wallet");
	});

	it("todo widget do catálogo tem descrição curta", () => {
		for (const id of HOME_WIDGET_IDS) {
			expect(WIDGET_DESCRIPTIONS[id].length).toBeGreaterThan(0);
			expect(WIDGET_DESCRIPTIONS[id].length).toBeLessThanOrEqual(40);
		}
	});
});
