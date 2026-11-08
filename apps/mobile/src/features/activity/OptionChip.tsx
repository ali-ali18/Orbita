import { colors, radius, spacing } from "@orbita/tokens";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Icon, Text } from "../../ui/index.ts";

/** Opção da gaveta de filtros (Figma: pílula de 34, `surface2`; marcada fica branca). Aceita marca à esquerda (logo, bolinha). */
export function OptionChip({
	label,
	selected,
	onPress,
	leading,
}: {
	label: string;
	selected: boolean;
	onPress: () => void;
	leading?: ReactNode;
}) {
	return (
		<Pressable
			accessibilityRole="checkbox"
			accessibilityLabel={label}
			accessibilityState={{ checked: selected }}
			onPress={onPress}
			// 34 desenhado + 5 de cada lado = 44 de toque.
			hitSlop={5}
			style={({ pressed }) => ({
				height: 34,
				flexDirection: "row",
				alignItems: "center",
				gap: spacing.sm,
				paddingHorizontal: 14,
				borderRadius: radius.pill,
				backgroundColor: selected ? colors.accent : colors.surface2,
				opacity: pressed ? 0.8 : 1,
			})}
		>
			{leading ? <View style={{ marginLeft: -6 }}>{leading}</View> : null}
			<Text variant="caption" tone={selected ? "onAccent" : "primary"}>
				{label}
			</Text>
		</Pressable>
	);
}

/** Etiqueta de filtro ativo, com "×" para tirar (acima da lista). */
export function FilterTag({ label, onRemove }: { label: string; onRemove: () => void }) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={`Remover filtro ${label}`}
			onPress={onRemove}
			hitSlop={5}
			style={({ pressed }) => ({
				height: 34,
				flexDirection: "row",
				alignItems: "center",
				gap: spacing.sm,
				paddingLeft: 14,
				paddingRight: spacing.md,
				borderRadius: radius.pill,
				backgroundColor: colors.surface2,
				opacity: pressed ? 0.8 : 1,
			})}
		>
			<Text variant="caption">{label}</Text>
			<Icon name="fechar" size={14} color={colors.textSecondary} />
		</Pressable>
	);
}
