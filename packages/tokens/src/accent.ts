/**
 * Cor primária (accent) escolhida pelo dono em Configurações → Tema. Só ação e seleção usam essa cor
 * (botão principal, chip ativo, switch ligado, ponto de não lido); ver styleguide.
 * `onAccent` é a cor do texto/ícone sobre o accent. Hex em maiúsculas, 6 dígitos.
 */
export const accentThemes = {
	atual: { accent: "#FFFFFF", onAccent: "#000000", label: "Atual" },
	volt: { accent: "#C2FF19", onAccent: "#000000", label: "Verde volt" },
	amarelo: { accent: "#FFC700", onAccent: "#000000", label: "Amarelo" },
	azul: { accent: "#2F5BFF", onAccent: "#FFFFFF", label: "Azul" },
	fucsia: { accent: "#FF2EE6", onAccent: "#000000", label: "Fúcsia" },
	laranja: { accent: "#FF7A1A", onAccent: "#000000", label: "Laranja" },
	violeta: { accent: "#7447FF", onAccent: "#FFFFFF", label: "Violeta" },
} as const;

export type AccentThemeKey = keyof typeof accentThemes;

/** Ordem de exibição na tela de tema. */
export const accentThemeKeys = Object.keys(accentThemes) as AccentThemeKey[];

export const defaultAccentTheme: AccentThemeKey = "atual";

export function isAccentThemeKey(value: unknown): value is AccentThemeKey {
	return typeof value === "string" && Object.hasOwn(accentThemes, value);
}
