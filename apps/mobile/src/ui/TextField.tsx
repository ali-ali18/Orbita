import { colors, radius, spacing, text as typography } from "@orbita/tokens";
import { type ComponentProps, type ComponentRef, type Ref, useState } from "react";
import { Platform, TextInput } from "react-native";
import { familyByWeight } from "./fonts.ts";

/**
 * Campo de texto das gavetas e formulários. O foco aparece como borda (token), nunca como contorno do
 * navegador, que o corte de um contêiner com rolagem deixava pela metade nas laterais.
 */
export function TextField({
	inputRef,
	multiline = false,
	style,
	onFocus,
	onBlur,
	...props
}: Omit<ComponentProps<typeof TextInput>, "ref"> & {
	inputRef?: Ref<ComponentRef<typeof TextInput>> | undefined;
}) {
	const [focused, setFocused] = useState(false);
	return (
		<TextInput
			{...(inputRef ? { ref: inputRef } : {})}
			multiline={multiline}
			placeholderTextColor={colors.textTertiary}
			onFocus={(e) => {
				setFocused(true);
				onFocus?.(e);
			}}
			onBlur={(e) => {
				setFocused(false);
				onBlur?.(e);
			}}
			style={[
				{
					minHeight: multiline ? 104 : 52,
					borderRadius: radius.inner,
					borderWidth: 1,
					borderColor: focused ? colors.textSecondary : colors.surface2,
					backgroundColor: colors.surface2,
					paddingHorizontal: spacing.lg - 1,
					paddingVertical: multiline ? spacing.md : 0,
					textAlignVertical: multiline ? "top" : "center",
					color: colors.text,
					fontFamily: familyByWeight[400],
					fontSize: typography.body.fontSize,
					lineHeight: typography.body.lineHeight,
				},
				Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null,
				style,
			]}
			{...props}
		/>
	);
}
