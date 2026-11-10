import { HOME_WIDGETS, type HomeLayout, type HomeWidgetId, type HomeWidgetSize } from "@orbita/shared";

/*
 * Regras puras do menu ancorado no widget (sem React, para testar): o que o menu oferece para cada widget, onde ele
 * fica na tela e quanto a lista precisa rolar para o widget aparecer inteiro.
 */

/** Um retângulo em coordenadas da janela (o que `measureInWindow` devolve). */
export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** A parte da janela que o menu e o widget podem usar. */
export interface MenuViewport {
	width: number;
	height: number;
	/** Faixa ocupada no topo (barra de status). */
	top: number;
	/** Faixa ocupada embaixo: barra de gestos, barra inferior ou teclado. */
	bottom: number;
}

export interface MenuPlacement {
	side: "below" | "above";
	top: number;
	left: number;
	/** O menu não coube nem acima nem abaixo e cobre parte do widget. */
	overlaps: boolean;
}

export interface PlacementInput {
	anchor: Rect;
	menu: { width: number; height: number };
	viewport: MenuViewport;
	/** Distância entre o widget e o menu. */
	gap: number;
	/** Folga mínima até as bordas da janela. */
	margin: number;
}

/**
 * Onde começa a parte da janela que o widget e o menu podem usar: a barra de status (ou a área segura, se maior) mais o
 * que ficar fixo acima da rolagem (o header e as abas do Início). Sem isso o widget revelado ficaria sob o header.
 */
export function viewportTop(safeTop: number, statusBar: number, fixedAbove = 0): number {
	return Math.max(safeTop, statusBar) + fixedAbove;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));

/**
 * Onde o menu fica: colado embaixo do widget se couber, senão em cima; se não couber em nenhum, vai para o lado
 * com mais espaço e encosta na borda (cobrindo parte do widget). Na horizontal acompanha a borda do widget: a
 * esquerda, ou a direita quando o widget está na metade direita (um 2x2 à direita), sem sair da tela.
 */
export function placeWidgetMenu({ anchor, menu, viewport, gap, margin }: PlacementInput): MenuPlacement {
	const minTop = viewport.top + margin;
	const maxBottom = viewport.height - viewport.bottom - margin;
	const anchorBottom = anchor.y + anchor.height;
	const spaceBelow = maxBottom - (anchorBottom + gap);
	const spaceAbove = anchor.y - gap - minTop;

	const fitsBelow = menu.height <= spaceBelow;
	const fitsAbove = menu.height <= spaceAbove;
	const side: MenuPlacement["side"] = fitsBelow
		? "below"
		: fitsAbove || spaceAbove > spaceBelow
			? "above"
			: "below";
	const wanted = side === "below" ? anchorBottom + gap : anchor.y - gap - menu.height;
	const top = clamp(wanted, minTop, maxBottom - menu.height);

	const onRight = anchor.x + anchor.width / 2 > viewport.width / 2;
	const wantedLeft = onRight ? anchor.x + anchor.width - menu.width : anchor.x;
	const left = clamp(wantedLeft, margin, viewport.width - margin - menu.width);

	return { side, top, left, overlaps: !fitsBelow && !fitsAbove };
}

export interface RevealInput {
	anchor: Rect;
	menuHeight: number;
	viewport: MenuViewport;
	/** Faixa de baixo que cobre a lista mas não o menu (a barra flutuante do Início). */
	bottomBar: number;
	gap: number;
	margin: number;
}

/**
 * Quanto a lista precisa rolar (positivo = o conteúdo sobe) para o widget ficar inteiro entre a barra de status e a
 * barra de baixo e, se a tela comportar os dois, sobrar lugar para o menu acima ou abaixo dele. Escolhe o menor
 * deslocamento. Widget mais alto que a área visível alinha pelo topo.
 */
export function revealScroll({ anchor, menuHeight, viewport, bottomBar, gap, margin }: RevealInput): number {
	const top = viewport.top + margin;
	const widgetBottom = viewport.height - Math.max(viewport.bottom, bottomBar) - margin;
	const menuBottom = viewport.height - viewport.bottom - margin;

	// Posições (y do topo do widget) em que ele aparece inteiro.
	const minY = top;
	const maxY = widgetBottom - anchor.height;
	if (maxY < minY) return anchor.y - minY;

	// Com o menu embaixo, o widget não pode passar de `belowMax`; com o menu em cima, não pode ficar antes de `aboveMin`.
	const belowMax = Math.min(maxY, menuBottom - menuHeight - gap - anchor.height);
	const aboveMin = Math.max(minY, top + menuHeight + gap);
	const candidates: number[] = [];
	if (belowMax >= minY) candidates.push(clamp(anchor.y, minY, belowMax));
	if (aboveMin <= maxY) candidates.push(clamp(anchor.y, aboveMin, maxY));
	// Sem lugar para os dois: só mostra o widget inteiro.
	if (candidates.length === 0) candidates.push(clamp(anchor.y, minY, maxY));

	const target = candidates.reduce((best, y) =>
		Math.abs(y - anchor.y) < Math.abs(best - anchor.y) ? y : best,
	);
	return anchor.y - target;
}

export interface WidgetMenuModel {
	id: HomeWidgetId;
	label: string;
	/** Só os tamanhos que o widget tem; vazio quando só existe um (não há o que escolher). */
	sizes: { size: HomeWidgetSize; selected: boolean }[];
	canMoveUp: boolean;
	canMoveDown: boolean;
	/** Há widgets ocultos para recolocar ("Adicionar widgets"). */
	canAdd: boolean;
}

/** O que o menu de um widget visível oferece; `null` se o widget não está no Início. */
export function widgetMenuModel(layout: HomeLayout, id: HomeWidgetId | null): WidgetMenuModel | null {
	const visible = layout.filter((i) => i.visible);
	const index = visible.findIndex((i) => i.id === id);
	const item = visible[index];
	if (!item) return null;
	const def = HOME_WIDGETS[item.id];
	return {
		id: item.id,
		label: def.label,
		sizes: def.sizes.length > 1 ? def.sizes.map((size) => ({ size, selected: size === item.size })) : [],
		canMoveUp: index > 0,
		canMoveDown: index < visible.length - 1,
		canAdd: layout.some((i) => !i.visible),
	};
}

/** Uma linha da gaveta "Adicionar widgets": o que está oculto, com o tamanho em que volta. */
export interface AddableWidget {
	id: HomeWidgetId;
	label: string;
	description: string;
	size: HomeWidgetSize;
}

/** Descrição curta de cada widget, para quem não lembra o que ele mostra. */
export const WIDGET_DESCRIPTIONS: Readonly<Record<HomeWidgetId, string>> = {
	hero: "Quanto ainda cabe no mês",
	wallet: "Faturas abertas dos cartões",
	balance: "Saldo somado das contas",
	limit: "Limite usado e disponível",
	cashflow: "Entradas e saídas do mês",
	installments: "Parcelas que ainda faltam",
	categories: "Para onde o dinheiro foi",
	subscriptions: "Compromisso mensal fixo",
	report: "Atalho para o fechamento do mês",
	recent: "Os lançamentos mais novos",
};

export function addableWidgets(layout: HomeLayout): AddableWidget[] {
	return layout
		.filter((i) => !i.visible)
		.map((i) => ({
			id: i.id,
			label: HOME_WIDGETS[i.id].label,
			description: WIDGET_DESCRIPTIONS[i.id],
			size: i.size,
		}));
}
