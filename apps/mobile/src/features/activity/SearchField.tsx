import { colors, radius, spacing, text as typography } from "@orbita/tokens";
import { TextInput, View } from "react-native";
import { familyByWeight, Icon } from "../../ui/index.ts";

/** `outlineStyle` existe só no react-native-web e fora dos tipos do RN: o tipo largo evita o erro sem `any`. */
const WEB_NO_OUTLINE: object = { outlineStyle: "none" };

/** Campo de busca do Figma ("buscar": 48 de altura, pílula, contorno `border`). */
export function SearchField({
	value,
	onChange,
	placeholder = "Buscar por nome, valor ou categoria",
	label = "Buscar lançamentos por nome, valor ou categoria",
}: {
	value: string;
	onChange: (next: string) => void;
	placeholder?: string;
	/** Rótulo para leitor de tela. */
	label?: string;
}) {
	return (
		<View
			style={{
				height: 48,
				borderRadius: radius.pill,
				backgroundColor: colors.surface,
				borderWidth: 1,
				borderColor: colors.border,
				flexDirection: "row",
				alignItems: "center",
				paddingHorizontal: spacing.lg,
				gap: 10,
			}}
		>
			<Icon name="buscar" size={20} color={colors.textSecondary} />
			<TextInput
				value={value}
				onChangeText={onChange}
				placeholder={placeholder}
				placeholderTextColor={colors.textSecondary}
				accessibilityLabel={label}
				returnKeyType="search"
				autoCorrect={false}
				autoCapitalize="none"
				style={{
					flex: 1,
					height: 48,
					color: colors.text,
					// Na web o foco desenharia um retângulo branco por cima da pílula.
					...WEB_NO_OUTLINE,
					fontFamily: familyByWeight[400],
					fontSize: typography.body.fontSize,
					letterSpacing: typography.body.letterSpacing,
				}}
			/>
		</View>
	);
}
