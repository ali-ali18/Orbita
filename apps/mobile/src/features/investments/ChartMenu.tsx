import { colors, layout, radius, spacing } from "@orbita/tokens";
import { type ComponentRef, useMemo, useRef, useState } from "react";
import { Modal, Pressable, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAccent } from "../../lib/theme.tsx";
import { Icon, type IconName, Text } from "../../ui/index.ts";
import { Dim } from "../summary/widgets/WidgetMenu.tsx";
import { type MenuViewport, placeWidgetMenu, type Rect } from "../summary/widgets/widget-menu-model.ts";
import { CHART_VIEW_LABELS, CHART_VIEWS, type ChartView } from "./chart-view.ts";

const MENU_WIDTH = 232;
const MENU_GAP = spacing.sm;
const MENU_MARGIN = spacing.sm;
/** Altura antes da primeira medida (o `onLayout` corrige em seguida). */
const MENU_HEIGHT_GUESS = 192;

const VIEW_ICONS: Record<ChartView, IconName> = { bars: "grafico", hbars: "menos", donut: "alvo" };

/**
 * Segurar o gráfico mede o card na janela e abre o menu "Ver como" colado nele (mesmo padrão do menu dos widgets:
 * o resto da tela escurece e o card continua visível).
 */
export function useChartMenu() {
	const insets = useSafeAreaInsets();
	const window = useWindowDimensions();
	const viewport: MenuViewport = useMemo(
		() => ({
			width: window.width,
			height: window.height,
			top: Math.max(insets.top, layout.statusBar),
			bottom: Math.max(insets.bottom, layout.homeIndicator),
		}),
		[window.width, window.height, insets.top, insets.bottom],
	);
	const ref = useRef<ComponentRef<typeof View>>(null);
	const [anchor, setAnchor] = useState<Rect | null>(null);
	return {
		/** Vai na `View` que envolve o card. */
		ref,
		anchor,
		viewport,
		show: () =>
			ref.current?.measureInWindow((x, y, width, height) => {
				if (width === 0 && height === 0) return;
				setAnchor({ x, y, width, height });
			}),
		close: () => setAnchor(null),
	};
}

export function ChartMenu({
	anchor,
	viewport,
	value,
	onPick,
	onClose,
}: {
	anchor: Rect | null;
	viewport: MenuViewport;
	value: ChartView;
	onPick: (view: ChartView) => void;
	onClose: () => void;
}) {
	const { accent, onAccent } = useAccent();
	const [height, setHeight] = useState(MENU_HEIGHT_GUESS);
	const place = anchor
		? placeWidgetMenu({
				anchor,
				menu: { width: MENU_WIDTH, height },
				viewport,
				gap: MENU_GAP,
				margin: MENU_MARGIN,
			})
		: null;
	return (
		<Modal
			visible={anchor !== null}
			transparent
			animationType="fade"
			onRequestClose={onClose}
			statusBarTranslucent
		>
			{anchor && place ? (
				<View accessibilityViewIsModal style={{ flex: 1 }}>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Fechar menu"
						onPress={onClose}
						style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
					/>
					<Dim hole={anchor} />
					<View
						accessibilityRole="menu"
						accessibilityLabel="Ver como"
						onLayout={(e) => setHeight(Math.round(e.nativeEvent.layout.height))}
						style={{
							position: "absolute",
							top: place.top,
							left: place.left,
							width: MENU_WIDTH,
							padding: spacing.sm,
							gap: spacing.xs,
							borderRadius: radius.group,
							backgroundColor: colors.surface2,
							borderWidth: 1,
							borderColor: colors.border,
						}}
					>
						<Text
							variant="caption"
							tone="secondary"
							style={{ paddingHorizontal: spacing.md, paddingTop: spacing.xs }}
						>
							Ver como
						</Text>
						{CHART_VIEWS.map((view) => {
							const selected = view === value;
							return (
								<Pressable
									key={view}
									accessibilityRole="menuitem"
									accessibilityLabel={CHART_VIEW_LABELS[view]}
									accessibilityState={{ selected }}
									onPress={() => {
										onPick(view);
										onClose();
									}}
									style={({ pressed }) => ({
										minHeight: layout.touchTarget,
										flexDirection: "row",
										alignItems: "center",
										gap: spacing.md,
										paddingHorizontal: spacing.md,
										borderRadius: radius.inner,
										backgroundColor: selected ? accent : "transparent",
										opacity: pressed ? 0.8 : 1,
									})}
								>
									<Icon name={VIEW_ICONS[view]} size={20} color={selected ? onAccent : colors.text} />
									<Text variant="body" tone={selected ? "onAccent" : "primary"} numberOfLines={1}>
										{CHART_VIEW_LABELS[view]}
									</Text>
								</Pressable>
							);
						})}
					</View>
				</View>
			) : null}
		</Modal>
	);
}
