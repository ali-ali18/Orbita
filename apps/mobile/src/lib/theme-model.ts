import { type AccentThemeKey, accentThemes, defaultAccentTheme, isAccentThemeKey } from "@orbita/tokens";

/** Tema guardado no aparelho -> chave válida. Nada guardado, valor velho ou lixo: o tema atual (branco). */
export function resolveAccentTheme(stored: string | null | undefined): AccentThemeKey {
	return isAccentThemeKey(stored) ? stored : defaultAccentTheme;
}

export interface Accent {
	key: AccentThemeKey;
	/** Cor primária: só ação e seleção (botão principal, chip ativo, switch, ponto de não lido). */
	accent: string;
	/** Texto e ícone sobre `accent`. */
	onAccent: string;
}

export function accentOf(key: AccentThemeKey): Accent {
	const { accent, onAccent } = accentThemes[key];
	return { key, accent, onAccent };
}
