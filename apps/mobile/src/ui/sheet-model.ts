/** Regras puras do gesto de arrastar a gaveta (sem React, para testar). */

/** Distância (px) que o arrasto para baixo precisa passar para fechar. */
export const SHEET_DISMISS_DISTANCE = 96;
/** Velocidade (px/ms) de um gesto rápido para baixo que fecha mesmo com pouca distância. */
export const SHEET_DISMISS_VELOCITY = 0.8;

/** Quanto o painel acompanha o dedo: nunca sobe acima do repouso. */
export function dragOffset(dy: number): number {
	return Math.max(0, dy);
}

/** Fecha se arrastou longe o bastante ou soltou com velocidade para baixo. */
export function shouldDismiss(dy: number, velocityY: number): boolean {
	return dy >= SHEET_DISMISS_DISTANCE || (dy > 0 && velocityY >= SHEET_DISMISS_VELOCITY);
}
