import { colors, layout, radius } from "@orbita/tokens";
import { Pressable } from "react-native";
import { useAccent } from "../lib/theme.tsx";
import { Icon, type IconName } from "./icons.tsx";

/**
 * Botão redondo só com ícone: o rótulo para leitor de tela é obrigatório. Abaixo de 44 o desenho
 * fica do tamanho pedido, mas o `hitSlop` completa a área de toque até 44.
 */
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
	/** Cor primária do tema com o ícone `onAccent` (ação principal). */
	filled?: boolean;
	/** Contorno de 1 em `border` (botões da barra de baixo). */
	bordered?: boolean;
	background?: string;
	disabled?: boolean;
}) {
	const { accent, onAccent } = useAccent();
	const slop = Math.max(0, (layout.touchTarget - size) / 2);
	return (
		<Pressable
			hitSlop={slop}
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
				flexShrink: 0,
				backgroundColor: filled ? accent : background,
				borderWidth: bordered ? 1 : 0,
				borderColor: colors.border,
				opacity: pressed ? 0.8 : 1,
			})}
		>
			<Icon name={icon} size={iconSize} color={filled ? onAccent : colors.text} />
		</Pressable>
	);
}
