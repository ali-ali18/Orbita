import { colors, radius, spacing } from "@orbita/tokens";
import { Pressable, ScrollView, View } from "react-native";
import { Text } from "../../ui/index.ts";
import { ACTIVITY_FILTERS, type ActivityFilter } from "./activity-model.ts";

/** Chips de filtro como no Figma (15 semibold, contorno `border`, ativo em branco). Alvo de toque de 44. */
export function FilterChips({
	value,
	onChange,
}: {
	value: ActivityFilter;
	onChange: (next: ActivityFilter) => void;
}) {
	return (
		<ScrollView
			horizontal
			showsHorizontalScrollIndicator={false}
			keyboardShouldPersistTaps="handled"
			// Sangra até a borda da tela: a lista tem margem de 16 e o chip rola por baixo dela.
			style={{ marginHorizontal: -spacing.lg }}
			contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}
		>
			{ACTIVITY_FILTERS.map((f) => {
				const active = f.id === value;
				return (
					<Pressable
						key={f.id}
						accessibilityRole="button"
						accessibilityLabel={f.label}
						accessibilityState={{ selected: active }}
						onPress={() => onChange(f.id)}
						style={{ minHeight: 44, justifyContent: "center" }}
					>
						<View
							style={{
								paddingHorizontal: 14,
								paddingVertical: 9,
								borderRadius: radius.pill,
								backgroundColor: active ? colors.accent : colors.surface,
								borderWidth: 1,
								borderColor: active ? colors.accent : colors.border,
							}}
						>
							<Text variant="bodyStrong" tone={active ? "onAccent" : "primary"}>
								{f.label}
							</Text>
						</View>
					</Pressable>
				);
			})}
		</ScrollView>
	);
}
