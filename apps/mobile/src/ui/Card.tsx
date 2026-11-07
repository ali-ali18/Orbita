import { colors, radius, spacing } from "@orbita/tokens";
import type { ReactNode } from "react";
import { Pressable, type StyleProp, View, type ViewStyle } from "react-native";
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
 * Topo de card: rótulo à esquerda e, à direita, "Ver tudo" ou a seta. Com `onAction` o "Ver tudo" é um
 * botão (alvo de 44); sem ele, é só um indicativo de que o bloco abre mais detalhe.
 */
export function CardHeader({
	title,
	chevron = false,
	action,
	onAction,
}: {
	title: string;
	chevron?: boolean;
	action?: string | undefined;
	onAction?: (() => void) | undefined;
}) {
	return (
		<View style={{ flexDirection: "row", alignItems: "center", minHeight: 20 }}>
			<Text variant="cardTitle" tone="secondary" style={{ flex: 1 }} accessibilityRole="header">
				{title}
			</Text>
			{action && onAction ? (
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={action}
					hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
					onPress={onAction}
					style={{ minHeight: 44, justifyContent: "center", marginVertical: -12 }}
				>
					<Text variant="caption">{action}</Text>
				</Pressable>
			) : action ? (
				<Text variant="caption">{action}</Text>
			) : null}
			{chevron ? <Icon name="seta-direita" size={18} color={colors.textTertiary} /> : null}
		</View>
	);
}
