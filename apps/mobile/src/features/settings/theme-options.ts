import { type AccentThemeKey, accentThemeKeys, accentThemes } from "@orbita/tokens";

export interface ThemeOption {
	key: AccentThemeKey;
	label: string;
	/** Cor da bolinha da opção. */
	accent: string;
}

/** As opções da tela Tema, na ordem dos tokens (Atual primeiro). */
export const themeOptions: readonly ThemeOption[] = accentThemeKeys.map((key) => ({
	key,
	label: accentThemes[key].label,
	accent: accentThemes[key].accent,
}));

/** Nome do tema para o valor da linha em Configurações. */
export function themeLabel(key: AccentThemeKey): string {
	return accentThemes[key].label;
}
