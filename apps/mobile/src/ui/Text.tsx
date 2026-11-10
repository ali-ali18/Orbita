import { colors, text as typography } from "@orbita/tokens";
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from "react-native";
import { useTheme } from "../lib/theme.tsx";
import { familyByWeight } from "./fonts.ts";

export type TextVariant = keyof typeof typography;
export type TextTone = "primary" | "secondary" | "tertiary" | "onAccent" | "positive" | "danger";

/** `onAccent` não está aqui: depende do tema e vem de `useTheme()` dentro de `Text`. */
const toneColor: Record<Exclude<TextTone, "onAccent">, string> = {
	primary: colors.text,
	secondary: colors.textSecondary,
	tertiary: colors.textTertiary,
	positive: colors.positive,
	danger: colors.danger,
};

/** Variantes que ficam em coluna (valor, lista) usam algarismos tabulares. */
const tabular: ReadonlySet<TextVariant> = new Set([
	"numberDisplay",
	"numberHero",
	"numberLarge",
	"numberMedium",
	"bodyStrong",
]);

export interface TextProps extends RNTextProps {
	variant?: TextVariant;
	tone?: TextTone;
}

export function Text({ variant = "body", tone = "primary", style, ...rest }: TextProps) {
	const { onAccent } = useTheme();
	const t = typography[variant];
	const base: TextStyle = {
		fontFamily: familyByWeight[t.fontWeight],
		fontSize: t.fontSize,
		lineHeight: t.lineHeight,
		letterSpacing: t.letterSpacing,
		color: tone === "onAccent" ? onAccent : toneColor[tone],
		...(tabular.has(variant) ? { fontVariant: ["tabular-nums"] } : {}),
	};
	return <RNText {...rest} style={[base, style]} />;
}
