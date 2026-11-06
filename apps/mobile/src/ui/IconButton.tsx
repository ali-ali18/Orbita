import { colors, radius } from "@orbita/tokens";
import { Pressable } from "react-native";
import { Icon, type IconName } from "./icons.tsx";

/** Botão redondo só com ícone: o rótulo para leitor de tela é obrigatório; área de toque ≥ 44. */
export function IconButton({
	icon,
	label,
	onPress,
	size = 44,
	iconSize = 20,
	filled = false,
	bordered = false,
	background = colors.surface,
	disabled = false,
}: {
	icon: IconName;
	label: string;
	onPress?: () => void;
	size?: number;
	iconSize?: number;
	/** Branco com ícone preto (ação principal). */
	filled?: boolean;
	/** Contorno de 1 em `border` (botões da barra de baixo). */
	bordered?: boolean;
	background?: string;
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
				borderRadius: radius.pill,
				alignItems: "center",
				justifyContent: "center",
				backgroundColor: filled ? colors.accent : background,
				borderWidth: bordered ? 1 : 0,
				borderColor: colors.border,
				opacity: pressed ? 0.8 : 1,
			})}
		>
			<Icon name={icon} size={iconSize} color={filled ? colors.onAccent : colors.text} />
		</Pressable>
	);
}
