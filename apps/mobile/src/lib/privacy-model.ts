/**
 * Estado inicial do olho ao abrir o app. Com "Esconder valores ao abrir" ligado, sempre começa escondido; senão volta
 * como ficou da última vez (e, sem nada guardado, visível). Falha ao ler o armazenamento = visível, como antes.
 */
export function initialHidden(stored: string | null, hideOnOpen: string | null): boolean {
	if (hideOnOpen === "1") return true;
	return stored === "1";
}
