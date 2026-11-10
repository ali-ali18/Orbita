import { colors, radius, spacing } from "@orbita/tokens";
import { ActivityIndicator, Pressable, type StyleProp, type ViewStyle } from "react-native";
import { useAccent } from "../lib/theme.tsx";
import { Icon, type IconName } from "./icons.tsx";
import { Text } from "./Text.tsx";

export interface ButtonProps {
	label: string;
	onPress: () => void;
	variant?: "primary" | "secondary";
	disabled?: boolean;
	loading?: boolean;
	/** Versão baixa (44) para dentro de cards. */
	compact?: boolean;
	/** Ícone de 18 antes do rótulo (o "+" de adicionar). */
	icon?: IconName;
	style?: StyleProp<ViewStyle>;
}

/** Botão em pílula, 52 de altura (alvo de toque ≥ 44). */
export function Button({
	label,
	onPress,
	variant = "primary",
	disabled = false,
	loading = false,
	compact = false,
	icon,
	style,
}: ButtonProps) {
	const { accent, onAccent } = useAccent();
	const primary = variant === "primary";
	const inactive = disabled || loading;
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityState={{ disabled: inactive, busy: loading }}
			disabled={inactive}
			onPress={onPress}
			style={({ pressed }) => [
				{
					minHeight: compact ? 44 : 52,
					borderRadius: radius.pill,
					paddingHorizontal: compact ? spacing.xl : spacing.xxl,
					alignItems: "center",
					justifyContent: "center",
					flexDirection: "row",
					gap: spacing.sm,
					backgroundColor: primary ? accent : colors.surface2,
					opacity: inactive && !loading ? 0.4 : pressed ? 0.8 : 1,
				},
				style,
			]}
		>
			{loading ? (
				<ActivityIndicator color={primary ? onAccent : colors.text} />
			) : (
				<>
					{icon ? <Icon name={icon} size={18} color={primary ? onAccent : colors.text} /> : null}
					<Text variant="bodyStrong" tone={primary ? "onAccent" : "primary"}>
						{label}
					</Text>
				</>
			)}
		</Pressable>
	);
}
