import { colors, radius, spacing } from "@orbita/tokens";
import { View } from "react-native";
import { OrbitaAvatar } from "./Avatar.tsx";
import { Icon } from "./Icon.tsx";
import { IconButton } from "./IconButton.tsx";
import { Text } from "./Text.tsx";

/**
 * Barra de baixo: início, campo "Pergunte à Órbita", "+" e o avatar do agente. O campo e o "+"
 * ainda não têm tela (ficam desativados); o início é a tela atual.
 */
export function BottomBar({ onHome }: { onHome?: () => void }) {
	return (
		<View
			style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg }}
		>
			<IconButton icon="home" label="Início" size={52} onPress={onHome ?? (() => {})} />
			<View
				accessibilityRole="button"
				accessibilityLabel="Pergunte à Órbita"
				accessibilityState={{ disabled: true }}
				style={{
					flex: 1,
					height: 52,
					borderRadius: radius.pill,
					backgroundColor: colors.surface,
					flexDirection: "row",
					alignItems: "center",
					paddingLeft: spacing.lg,
					paddingRight: spacing.sm,
					gap: spacing.sm,
				}}
			>
				<Icon name="scan" size={20} color={colors.textSecondary} />
				<Text variant="body" tone="secondary" style={{ flex: 1 }} numberOfLines={1}>
					Pergunte à Órbita
				</Text>
				<IconButton icon="plus" label="Novo lançamento" size={44} filled disabled />
			</View>
			<OrbitaAvatar size={52} />
		</View>
	);
}
