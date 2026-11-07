import { colors, text as typography } from "@orbita/tokens";
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from "react-native";
import { familyByWeight } from "./fonts.ts";

export type TextVariant = keyof typeof typography;
export type TextTone = "primary" | "secondary" | "tertiary" | "onAccent";

const toneColor: Record<TextTone, string> = {
	primary: colors.text,
	secondary: colors.textSecondary,
	tertiary: colors.textTertiary,
	onAccent: colors.onAccent,
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
	const t = typography[variant];
	const base: TextStyle = {
		fontFamily: familyByWeight[t.fontWeight],
		fontSize: t.fontSize,
		lineHeight: t.lineHeight,
		letterSpacing: t.letterSpacing,
		color: toneColor[tone],
		...(tabular.has(variant) ? { fontVariant: ["tabular-nums"] } : {}),
	};
	return <RNText {...rest} style={[base, style]} />;
}
