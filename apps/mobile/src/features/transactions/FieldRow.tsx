import { colors, spacing } from "@orbita/tokens";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Icon, Text } from "../../ui/index.ts";

/**
 * Linha de campo do Figma ("campos"): rótulo à esquerda em `textSecondary`, valor à direita e, se
 * abre uma escolha, a seta para baixo. Divisória de 1 embaixo; 16 de respiro em cima e embaixo.
 * Sem `onPress` a linha só hospeda o valor (ex.: o campo de texto da descrição).
 */
export function FieldRow({
	label,
	onPress,
	children,
	accessibilityValue,
}: {
	label: string;
	onPress?: () => void;
	children: ReactNode;
	/** Texto lido pelo leitor de tela junto do rótulo, quando o valor é um elemento visual (logo + nome). */
	accessibilityValue?: string;
}) {
	const body = (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: spacing.sm,
				paddingVertical: spacing.lg,
				borderBottomWidth: 1,
				borderBottomColor: colors.border,
			}}
		>
			<Text variant="body" tone="secondary" style={{ flex: 1 }}>
				{label}
			</Text>
			{children}
			{onPress ? <Icon name="seta-baixo" size={16} color={colors.textSecondary} /> : null}
		</View>
	);
	if (!onPress) return body;
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={accessibilityValue ? `${label}: ${accessibilityValue}` : label}
			onPress={onPress}
			style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
		>
			{body}
		</Pressable>
	);
}
