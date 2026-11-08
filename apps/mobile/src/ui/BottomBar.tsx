import { colors, layout, radius, spacing } from "@orbita/tokens";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { OrbitaAvatar } from "./Avatar.tsx";
import { IconButton } from "./IconButton.tsx";
import { Icon } from "./icons.tsx";
import { Text } from "./Text.tsx";

/** Mesma altura útil da barra no Figma ("Barra/Inferior"): 52 de botão e 2 de folga em cada lado. */
const ROW_HEIGHT = 56;
const BUTTON = 52;

/** Altura total da barra flutuante, para a tela reservar esse espaço no fim da rolagem. */
export function useBottomBarHeight(): number {
	const insets = useSafeAreaInsets();
	return spacing.md + ROW_HEIGHT + Math.max(insets.bottom, layout.homeIndicator);
}

/**
 * Barra de baixo: início, campo "Pergunte à Órbita" com o "+" dentro e o avatar do agente.
 * O campo e o avatar abrem o chat (`onAsk`); o "+" abre o Novo lançamento (`onNew`).
 * Flutua sobre o conteúdo, sem fundo (o degradê ficava com faixas no Android).
 */
export function BottomBar({
	onHome,
	onNew,
	onAsk,
}: {
	onHome?: () => void;
	onNew?: () => void;
	onAsk?: () => void;
}) {
	const insets = useSafeAreaInsets();
	return (
		<View
			pointerEvents="box-none"
			style={{
				paddingTop: spacing.md,
				paddingHorizontal: spacing.lg,
				paddingBottom: Math.max(insets.bottom, layout.homeIndicator),
			}}
		>
			<View style={{ height: ROW_HEIGHT, flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
				<IconButton
					icon="inicio"
					label="Início"
					size={BUTTON}
					iconSize={24}
					bordered
					background={colors.surface2}
					onPress={onHome ?? (() => {})}
				/>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Pergunte à Órbita"
					accessibilityState={{ disabled: !onAsk }}
					disabled={!onAsk}
					onPress={onAsk}
					style={{
						flex: 1,
						height: BUTTON,
						borderRadius: radius.pill,
						backgroundColor: colors.surface,
						borderWidth: 1,
						borderColor: colors.border,
						flexDirection: "row",
						alignItems: "center",
						paddingLeft: spacing.lg,
						paddingRight: spacing.xs,
						gap: spacing.sm,
					}}
				>
					<Icon name="escanear" size={20} color={colors.textSecondary} />
					<Text variant="body" tone="secondary" style={{ flex: 1 }} numberOfLines={1}>
						Pergunte à Órbita
					</Text>
					<IconButton
						icon="mais"
						label="Novo lançamento"
						size={40}
						iconSize={22}
						filled
						{...(onNew ? { onPress: onNew } : { disabled: true })}
					/>
				</Pressable>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Abrir o chat"
					accessibilityState={{ disabled: !onAsk }}
					disabled={!onAsk}
					onPress={onAsk}
					style={{
						width: BUTTON,
						height: BUTTON,
						borderRadius: radius.pill,
						backgroundColor: colors.surface,
						borderWidth: 1,
						borderColor: colors.border,
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<OrbitaAvatar size={32} />
				</Pressable>
			</View>
		</View>
	);
}
