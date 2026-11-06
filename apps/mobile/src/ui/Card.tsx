import { colors, radius, spacing } from "@orbita/tokens";
import type { ReactNode } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";
import { Icon } from "./icons.tsx";
import { Text } from "./Text.tsx";

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
	return (
		<View
			style={[{ backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.xl }, style]}
		>
			{children}
		</View>
	);
}

/**
 * Topo de card: rótulo à esquerda e, à direita, "Ver tudo" ou a seta (só indicam que o bloco abre
 * mais detalhe; ainda não há telas de destino).
 */
export function CardHeader({
	title,
	chevron = false,
	action,
}: {
	title: string;
	chevron?: boolean;
	action?: string | undefined;
}) {
	return (
		<View style={{ flexDirection: "row", alignItems: "center", minHeight: 20 }}>
			<Text variant="cardTitle" tone="secondary" style={{ flex: 1 }} accessibilityRole="header">
				{title}
			</Text>
			{action ? <Text variant="caption">{action}</Text> : null}
			{chevron ? <Icon name="seta-direita" size={18} color={colors.textTertiary} /> : null}
		</View>
	);
}
