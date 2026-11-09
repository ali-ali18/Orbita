/*
 * Teclado em Android de ponta a ponta. A janela não encolhe: quem sobe o conteúdo é o app, com a altura real do teclado
 * (insets do IME, lida pelo keyboard-controller), sem medir o layout.
 */

/**
 * Folga a reservar embaixo do conteúdo para o teclado não cobri-lo. `keyboardHeight` vem dos eventos do
 * keyboard-controller (positiva quando aberto, 0 fechado) e já inclui a barra de navegação; o `Screen` reserva `bottomInset` abaixo do
 * conteúdo, então essa parte já está paga e é descontada.
 */
export function keyboardPadding(keyboardHeight: number, bottomInset: number): number {
	const open = Math.max(0, keyboardHeight);
	return Math.max(0, open - Math.max(0, bottomInset));
}
