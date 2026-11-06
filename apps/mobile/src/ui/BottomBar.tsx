import { colors, radius, spacing } from "@orbita/tokens";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { OrbitaAvatar } from "./Avatar.tsx";
import { IconButton } from "./IconButton.tsx";
import { Icon } from "./icons.tsx";
import { Text } from "./Text.tsx";

/** Mesma altura útil da barra no Figma ("Barra/Inferior"): 52 de botão e 2 de folga em cada lado. */
const ROW_HEIGHT = 56;
const BUTTON = 52;

/** Degradê do Figma: transparente em cima, preto a 92% em 45% e preto cheio embaixo. */
function Backdrop() {
	return (
		<Svg
			style={StyleSheet.absoluteFill}
			width="100%"
			height="100%"
			preserveAspectRatio="none"
			pointerEvents="none"
			accessibilityElementsHidden
		>
			<Defs>
				<LinearGradient id="bar-fade" x1="0" y1="0" x2="0" y2="1">
					<Stop offset="0" stopColor={colors.background} stopOpacity={0} />
					<Stop offset="0.45" stopColor={colors.background} stopOpacity={0.92} />
					<Stop offset="1" stopColor={colors.background} stopOpacity={1} />
				</LinearGradient>
			</Defs>
			<Rect width="100%" height="100%" fill="url(#bar-fade)" />
		</Svg>
	);
}

/**
 * Barra de baixo: início, campo "Pergunte à Órbita" com o "+" dentro e o avatar do agente. O campo e
 * o "+" ainda não têm tela (ficam desativados); o início é a tela atual. Flutua sobre o conteúdo,
 * com o degradê do Figma por trás.
 */
export function BottomBar({ onHome }: { onHome?: () => void }) {
	const insets = useSafeAreaInsets();
	return (
		<View
			style={{
				paddingTop: spacing.md,
				paddingHorizontal: spacing.lg,
				paddingBottom: Math.max(insets.bottom, spacing.xxl + spacing.xs),
			}}
		>
			<Backdrop />
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
				<View
					accessibilityRole="button"
					accessibilityLabel="Pergunte à Órbita"
					accessibilityState={{ disabled: true }}
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
					<IconButton icon="mais" label="Novo lançamento" size={40} iconSize={22} filled disabled />
				</View>
				<View
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
				</View>
			</View>
		</View>
	);
}
