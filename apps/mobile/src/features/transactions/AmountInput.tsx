import type { Cents } from "@orbita/core";
import { colors } from "@orbita/tokens";
import { TextInput, View } from "react-native";
import { Text } from "../../ui/index.ts";
import { amountToDigits, applyAmountText, formatAmount } from "./new-transaction-model.ts";

/**
 * Valor grande (Figma "valor"). Teclado de centavos: um campo de texto invisível, esticado sobre o
 * número, recebe os dígitos; o número formatado e o cursor de 2 × 44 são só desenho.
 */
export function AmountInput({
	cents,
	onChange,
	autoFocus,
	label = "Valor do lançamento",
}: {
	cents: Cents;
	onChange: (cents: Cents) => void;
	autoFocus?: boolean;
	/** Rótulo lido pelo leitor de tela (o campo é invisível). */
	label?: string;
}) {
	const formatted = formatAmount(cents);
	return (
		<View style={{ minHeight: 60, justifyContent: "center" }}>
			<View pointerEvents="none" style={{ flexDirection: "row", alignItems: "center" }}>
				<Text
					variant="numberDisplay"
					numberOfLines={1}
					adjustsFontSizeToFit
					style={{ flexShrink: 1 }}
					accessibilityElementsHidden
					importantForAccessibility="no"
				>
					{formatted}
				</Text>
				<View style={{ width: 2, height: 44, marginLeft: 2, backgroundColor: colors.text }} />
			</View>
			<TextInput
				value={amountToDigits(cents)}
				onChangeText={(text) => onChange(applyAmountText(cents, text))}
				keyboardType="number-pad"
				inputMode="numeric"
				autoFocus={autoFocus}
				caretHidden
				maxLength={12}
				accessibilityLabel={label}
				accessibilityValue={{ text: formatted }}
				style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0 }}
			/>
		</View>
	);
}
