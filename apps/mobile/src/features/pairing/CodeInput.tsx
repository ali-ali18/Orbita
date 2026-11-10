import { PAIRING_CODE_LENGTH } from "@orbita/shared";
import { colors, radius, spacing } from "@orbita/tokens";
import { type ComponentRef, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { useAccent } from "../../lib/theme.tsx";
import { Text } from "../../ui/index.ts";
import { sanitizeCode } from "./pairing-model.ts";

/**
 * Seis caixas como no Figma. Por baixo há UM campo de texto invisível (teclado numérico, cola e
 * preenchimento por SMS funcionam); tocar em qualquer caixa foca nele.
 */
export function CodeInput({
	value,
	onChange,
	onSubmit,
}: {
	value: string;
	onChange: (code: string) => void;
	onSubmit: () => void;
}) {
	const { accent } = useAccent();
	const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
	const [focused, setFocused] = useState(false);
	const activeIndex = Math.min(value.length, PAIRING_CODE_LENGTH - 1);

	return (
		<Pressable
			onPress={() => inputRef.current?.focus()}
			accessibilityLabel="Código de pareamento, 6 números"
			accessibilityRole="none"
		>
			<View style={{ flexDirection: "row", gap: spacing.sm }}>
				{Array.from({ length: PAIRING_CODE_LENGTH }, (_, i) => {
					const active = focused && i === activeIndex;
					return (
						<View
							// biome-ignore lint/suspicious/noArrayIndexKey: posição fixa de cada caixa
							key={i}
							style={{
								flex: 1,
								height: 56,
								borderRadius: radius.inner,
								backgroundColor: colors.surface,
								borderWidth: active ? 1.5 : 1,
								borderColor: active ? accent : colors.border,
								alignItems: "center",
								justifyContent: "center",
							}}
						>
							<Text variant="numberMedium">{value[i] ?? ""}</Text>
						</View>
					);
				})}
			</View>
			<TextInput
				ref={inputRef}
				value={value}
				onChangeText={(t) => onChange(sanitizeCode(t))}
				onFocus={() => setFocused(true)}
				onBlur={() => setFocused(false)}
				onSubmitEditing={onSubmit}
				keyboardType="number-pad"
				inputMode="numeric"
				maxLength={PAIRING_CODE_LENGTH + 1}
				autoComplete="sms-otp"
				textContentType="oneTimeCode"
				returnKeyType="go"
				caretHidden
				accessibilityLabel="Código de pareamento"
				// Cobre as caixas e fica invisível; precisa existir (e ser tocável) para o teclado abrir.
				style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0.02 }}
			/>
		</Pressable>
	);
}
