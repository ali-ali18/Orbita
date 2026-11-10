import type { HomeWidgetSize } from "@orbita/shared";
import { colors, layout, radius, spacing } from "@orbita/tokens";
import { Modal, Pressable, View } from "react-native";
import { useAccent } from "../../../lib/theme.tsx";
import { Icon, type IconName, Text } from "../../../ui/index.ts";
import { SizeGlyph } from "./SizeGlyph.tsx";
import { MENU_GAP, MENU_MARGIN } from "./use-widget-menu.ts";
import { type MenuViewport, placeWidgetMenu, type Rect, type WidgetMenuModel } from "./widget-menu-model.ts";

const MENU_WIDTH = 264;
const DISABLED_OPACITY = 0.35;

/** Escurece tudo menos o retângulo do widget: quatro faixas em volta dele, sem receber toque. */
function Dim({ hole }: { hole: Rect }) {
	const top = Math.max(0, Math.round(hole.y));
	const bottom = Math.round(hole.y + hole.height);
	const left = Math.max(0, Math.round(hole.x));
	const right = Math.round(hole.x + hole.width);
	const shade = { position: "absolute", backgroundColor: colors.background, opacity: 0.7 } as const;
	return (
		<View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
			<View style={[shade, { top: 0, left: 0, right: 0, height: top }]} />
			<View style={[shade, { top: bottom, left: 0, right: 0, bottom: 0 }]} />
			<View style={[shade, { top, left: 0, width: left, height: bottom - top }]} />
			<View style={[shade, { top, left: right, right: 0, height: bottom - top }]} />
		</View>
	);
}

function Row({
	icon,
	label,
	danger = false,
	disabled = false,
	onPress,
}: {
	icon: IconName;
	label: string;
	danger?: boolean;
	/** Ação indisponível (mover na ponta): a linha fica no lugar, apagada, e a altura do menu não muda. */
	disabled?: boolean;
	onPress: () => void;
}) {
	return (
		<Pressable
			accessibilityRole="menuitem"
			accessibilityLabel={label}
			accessibilityState={{ disabled }}
			disabled={disabled}
			onPress={onPress}
			style={({ pressed }) => ({
				minHeight: layout.touchTarget,
				flexDirection: "row",
				alignItems: "center",
				gap: spacing.md,
				paddingHorizontal: spacing.md,
				borderRadius: radius.inner,
				opacity: disabled ? DISABLED_OPACITY : pressed ? 0.8 : 1,
			})}
		>
			<Icon name={icon} size={20} color={danger ? colors.danger : colors.text} />
			<Text variant="body" tone={danger ? "danger" : "primary"} numberOfLines={1}>
				{label}
			</Text>
		</Pressable>
	);
}

/**
 * O menu de segurar, colado no próprio widget: o widget continua visível (o resto da tela escurece) e o menu abre
 * embaixo ou em cima dele, conforme o espaço. Tamanho e ordem valem na hora e o menu continua aberto, acompanhando o
 * widget, para o dono ver o resultado e trocar de novo. Fecha tocando fora ou no voltar do Android.
 */
export function WidgetMenu({
	menu,
	viewport,
	menuHeight,
	onMenuHeight,
	valuesHidden,
	onToggleValues,
	onSize,
	onMove,
	onRemove,
	onAdd,
	onClose,
}: {
	menu: { model: WidgetMenuModel; anchor: Rect } | null;
	viewport: MenuViewport;
	menuHeight: number;
	onMenuHeight: (height: number) => void;
	valuesHidden: boolean;
	onToggleValues: () => void;
	onSize: (size: HomeWidgetSize) => void;
	onMove: (direction: -1 | 1) => void;
	onRemove: () => void;
	onAdd: () => void;
	onClose: () => void;
}) {
	const { accent, onAccent } = useAccent();
	const place = menu
		? placeWidgetMenu({
				anchor: menu.anchor,
				menu: { width: MENU_WIDTH, height: menuHeight },
				viewport,
				gap: MENU_GAP,
				margin: MENU_MARGIN,
			})
		: null;
	return (
		<Modal
			visible={menu !== null}
			transparent
			animationType="fade"
			onRequestClose={onClose}
			statusBarTranslucent
		>
			{menu && place ? (
				<View accessibilityViewIsModal style={{ flex: 1 }}>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Fechar menu"
						onPress={onClose}
						style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
					/>
					<Dim hole={menu.anchor} />
					<View
						accessibilityRole="menu"
						accessibilityLabel={`Editar ${menu.model.label}`}
						onLayout={(e) => onMenuHeight(Math.round(e.nativeEvent.layout.height))}
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
						{menu.model.sizes.length > 0 ? (
							<View style={{ flexDirection: "row", gap: spacing.xs }}>
								{menu.model.sizes.map(({ size, selected }) => (
									<Pressable
										key={size}
										accessibilityRole="menuitem"
										accessibilityLabel={`Tamanho ${size}`}
										accessibilityState={{ selected }}
										onPress={() => onSize(size)}
										style={({ pressed }) => ({
											flex: 1,
											minHeight: layout.touchTarget,
											flexDirection: "row",
											alignItems: "center",
											justifyContent: "center",
											gap: spacing.sm,
											borderRadius: radius.inner,
											backgroundColor: selected ? accent : colors.surface,
											opacity: pressed ? 0.8 : 1,
										})}
									>
										<SizeGlyph size={size} color={selected ? onAccent : colors.textSecondary} />
										<Text variant="caption" tone={selected ? "onAccent" : "primary"}>
											{size}
										</Text>
									</Pressable>
								))}
							</View>
						) : null}
						<Row
							icon="seta-cima"
							label="Mover para cima"
							disabled={!menu.model.canMoveUp}
							onPress={() => onMove(-1)}
						/>
						<Row
							icon="seta-baixo"
							label="Mover para baixo"
							disabled={!menu.model.canMoveDown}
							onPress={() => onMove(1)}
						/>
						<Row
							icon={valuesHidden ? "olho" : "olho-cortado"}
							label={valuesHidden ? "Mostrar dados" : "Ocultar dados"}
							onPress={onToggleValues}
						/>
						{menu.model.canAdd ? <Row icon="mais" label="Adicionar widgets" onPress={onAdd} /> : null}
						<Row icon="lixeira" label="Remover do Início" danger onPress={onRemove} />
					</View>
				</View>
			) : null}
		</Modal>
	);
}
