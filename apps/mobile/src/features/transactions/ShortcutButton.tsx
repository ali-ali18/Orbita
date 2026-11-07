import { colors, radius, spacing } from "@orbita/tokens";
import { Pressable } from "react-native";
import { Icon, type IconName, Text } from "../../ui/index.ts";

/** Pílula pequena do Figma ("Ler comprovante", "Ditar"): ícone de 16 + texto `caption`, contorno `border`. */
export function ShortcutButton({
	icon,
	label,
	disabled = false,
	onPress,
}: {
	icon: IconName;
	label: string;
	disabled?: boolean;
	onPress?: () => void;
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityState={{ disabled }}
			disabled={disabled || !onPress}
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
				backgroundColor: colors.surface,
				borderWidth: 1,
				borderColor: colors.border,
				opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
			})}
		>
			<Icon name={icon} size={16} />
			<Text variant="caption">{label}</Text>
		</Pressable>
	);
}
