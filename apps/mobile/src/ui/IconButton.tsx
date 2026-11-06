import { colors } from "@orbita/tokens";
import { Pressable } from "react-native";
import { Icon, type IconName } from "./Icon.tsx";

/** Botão redondo só com ícone: o rótulo para leitor de tela é obrigatório; área de toque ≥ 44. */
export function IconButton({
	icon,
	label,
	onPress,
	size = 44,
	filled = false,
	disabled = false,
}: {
	icon: IconName;
	label: string;
	onPress?: () => void;
	size?: number;
	filled?: boolean;
	disabled?: boolean;
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityState={{ disabled }}
			disabled={disabled || !onPress}
			onPress={onPress}
			style={({ pressed }) => ({
				width: size,
				height: size,
				borderRadius: size / 2,
				alignItems: "center",
				justifyContent: "center",
				backgroundColor: filled ? colors.accent : colors.surface,
				opacity: pressed ? 0.8 : 1,
			})}
		>
			<Icon name={icon} color={filled ? colors.onAccent : colors.text} />
		</Pressable>
	);
}
