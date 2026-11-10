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
