/*
 * Abas do Início (Contas | Investimentos): a página vem do arrasto horizontal (posição da rolagem) ou do toque na aba.
 * Puro, para testar.
 */

export const HOME_TABS = [
	{ id: "accounts", label: "Contas" },
	{ id: "investments", label: "Investimentos" },
] as const;
export type HomeTabId = (typeof HOME_TABS)[number]["id"];

/** A página mais perto da posição atual da rolagem; sem largura medida ainda, a primeira. */
export function pageFromOffset(offsetX: number, pageWidth: number, count: number): number {
	if (pageWidth <= 0 || count <= 0) return 0;
	return Math.min(count - 1, Math.max(0, Math.round(offsetX / pageWidth)));
}

/** Onde a rolagem para ao escolher a aba `index`. */
export function offsetOfPage(index: number, pageWidth: number): number {
	return Math.max(0, index) * pageWidth;
}

/**
 * Página à vista durante a rolagem. Enquanto a rolagem anima até a aba tocada (`target`), a aba fica no destino: o
 * `onScroll` passa pela página de origem e não pode piscar a aba de volta. Chegou (a página mais perto é o destino),
 * o destino é liberado e o arrasto volta a mandar.
 */
export function resolvePage(
	offsetX: number,
	pageWidth: number,
	count: number,
	target: number | null,
): { page: number; target: number | null } {
	const near = pageFromOffset(offsetX, pageWidth, count);
	if (target === null) return { page: near, target: null };
	return near === target ? { page: target, target: null } : { page: target, target };
}

/** Abaixo disso as abas estão praticamente invisíveis e não recebem toque. */
export const TABS_TOUCH_MIN_OPACITY = 0.1;

/**
 * Opacidade das abas pela rolagem vertical da página à vista: 1 no topo, cai linearmente até 0 ao rolar a altura das
 * abas e fica em 0 depois; a rolagem elástica do topo (negativa) mantém 1. Volta linearmente ao subir.
 */
export function tabsFade(scrollY: number, tabsHeight: number): number {
	if (tabsHeight <= 0) return 0;
	return Math.min(1, Math.max(0, 1 - scrollY / tabsHeight));
}

/** Só recebe toque enquanto estiver visível o bastante. */
export function tabsTouchable(opacity: number): boolean {
	return opacity >= TABS_TOUCH_MIN_OPACITY;
}
