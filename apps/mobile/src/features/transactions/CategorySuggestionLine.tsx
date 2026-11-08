import { colors, spacing } from "@orbita/tokens";
import { Pressable, View } from "react-native";
import { Icon, Text } from "../../ui/index.ts";
import { type CategorySuggestion, suggestionText } from "./category-suggestion.ts";

/** Ação em texto, com alvo de toque estendido por `hitSlop`. */
function TextAction({ label, onPress }: { label: string; onPress: () => void }) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			onPress={onPress}
			hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
			style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
		>
			<Text variant="caption">{label}</Text>
		</Pressable>
	);
}

/**
 * A linha de baixo das categorias no Figma (33:404): brilho + "Sugeri Delivery porque iFood costuma ser delivery".
 * A sugestão já vem marcada nas categorias; aqui o dono a aceita ou a troca. Regra aprendida, sem IA.
 */
export function CategorySuggestionLine({
	suggestion,
	onAccept,
	onChange,
}: {
	suggestion: CategorySuggestion;
	onAccept: () => void;
	onChange: () => void;
}) {
	return (
		<View style={{ gap: spacing.sm }}>
			<View
				accessibilityLiveRegion="polite"
				style={{
					flexDirection: "row",
					alignItems: "flex-start",
					gap: spacing.sm,
					paddingHorizontal: spacing.xs,
				}}
			>
				<View style={{ paddingTop: 1 }}>
					<Icon name="brilho" size={14} color={colors.textSecondary} />
				</View>
				<Text variant="caption" tone="secondary" style={{ flex: 1 }}>
					{suggestionText(suggestion)}
				</Text>
			</View>
			<View style={{ flexDirection: "row", gap: spacing.lg, paddingLeft: spacing.xs + 14 + spacing.sm }}>
				<TextAction label="Aceitar" onPress={onAccept} />
				<TextAction label="Trocar" onPress={onChange} />
			</View>
		</View>
	);
}
