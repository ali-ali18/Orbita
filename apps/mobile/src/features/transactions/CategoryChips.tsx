import { colors, radius, spacing } from "@orbita/tokens";
import { Pressable, View } from "react-native";
import { useAccent } from "../../lib/theme.tsx";
import { Text } from "../../ui/index.ts";
import { categoryDot } from "./new-transaction-model.ts";

export interface CategoryOption {
	id: string;
	name: string;
	slug?: string;
	chartSlot: number | null;
}

/** Chip de categoria do Figma: bolinha na cor do gráfico + nome; o escolhido fica branco. */
function CategoryChip({
	category,
	selected,
	onPress,
}: {
	category: CategoryOption;
	selected: boolean;
	onPress: () => void;
}) {
	const { accent } = useAccent();
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={category.name}
			accessibilityState={{ selected }}
			onPress={onPress}
			hitSlop={4}
			style={({ pressed }) => ({
				flexDirection: "row",
				alignItems: "center",
				gap: spacing.sm,
				paddingLeft: spacing.md,
				paddingRight: spacing.md,
				paddingVertical: spacing.sm,
				borderRadius: radius.pill,
				backgroundColor: selected ? accent : colors.surface,
				borderWidth: selected ? 0 : 1,
				borderColor: colors.border,
				opacity: pressed ? 0.8 : 1,
			})}
		>
			<View
				style={{
					width: 8,
					height: 8,
					borderRadius: radius.pill,
					backgroundColor: categoryDot(category.chartSlot, category.slug),
				}}
			/>
			<Text variant="caption" tone={selected ? "onAccent" : "primary"}>
				{category.name}
			</Text>
		</Pressable>
	);
}

/** Lista de categorias em linhas que quebram. Tocar no escolhido de novo tira a escolha (categoria é opcional). */
export function CategoryChips({
	categories,
	selectedId,
	onSelect,
	allowNew = true,
}: {
	categories: readonly CategoryOption[];
	selectedId: string | null;
	onSelect: (id: string | null) => void;
	/** Mostra o "+ Nova" (desativado por enquanto). */
	allowNew?: boolean;
}) {
	return (
		<View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
			{categories.map((c) => (
				<CategoryChip
					key={c.id}
					category={c}
					selected={c.id === selectedId}
					onPress={() => onSelect(c.id === selectedId ? null : c.id)}
				/>
			))}
			{allowNew ? (
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Nova categoria"
					accessibilityState={{ disabled: true }}
					disabled
					style={{
						paddingHorizontal: spacing.md,
						paddingVertical: spacing.sm,
						borderRadius: radius.pill,
						backgroundColor: colors.surface,
						borderWidth: 1,
						borderColor: colors.border,
						opacity: 0.5,
					}}
				>
					<Text variant="caption">+ Nova</Text>
				</Pressable>
			) : null}
		</View>
	);
}
