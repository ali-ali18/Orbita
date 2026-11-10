import type { HomeWidgetId } from "@orbita/shared";
import { colors, layout, radius, spacing } from "@orbita/tokens";
import { Pressable, View } from "react-native";
import { Icon, Sheet, SheetGroup, Text } from "../../../ui/index.ts";
import { SizeGlyph } from "./SizeGlyph.tsx";
import type { AddableWidget } from "./widget-menu-model.ts";

/**
 * Gaveta "Adicionar widgets": só os que estão fora do Início, com o nome, o que mostram e o tamanho em que voltam.
 * Tocar recoloca na hora (no fim do Início) e a gaveta continua aberta para o próximo.
 */
export function AddWidgetsSheet({
	visible,
	widgets,
	onAdd,
	onClose,
}: {
	visible: boolean;
	widgets: AddableWidget[];
	onAdd: (id: HomeWidgetId) => void;
	onClose: () => void;
}) {
	return (
		<Sheet visible={visible} title="Adicionar widgets" onClose={onClose}>
			<SheetGroup>
				{widgets.map((w) => (
					<Pressable
						key={w.id}
						accessibilityRole="button"
						accessibilityLabel={`Adicionar ${w.label}, ${w.description}, tamanho ${w.size}`}
						onPress={() => onAdd(w.id)}
						style={({ pressed }) => ({
							minHeight: 56,
							flexDirection: "row",
							alignItems: "center",
							gap: spacing.md,
							paddingHorizontal: spacing.lg,
							paddingVertical: spacing.md,
							opacity: pressed ? 0.8 : 1,
						})}
					>
						<View
							style={{
								width: layout.touchTarget,
								height: layout.touchTarget,
								borderRadius: radius.inner,
								backgroundColor: colors.surface,
								alignItems: "center",
								justifyContent: "center",
							}}
						>
							<SizeGlyph size={w.size} />
						</View>
						<View style={{ flex: 1 }}>
							<Text variant="body" numberOfLines={1}>
								{w.label}
							</Text>
							<Text variant="caption" tone="secondary" numberOfLines={1}>
								{w.description} · {w.size}
							</Text>
						</View>
						<Icon name="mais" size={20} color={colors.textSecondary} />
					</Pressable>
				))}
			</SheetGroup>
		</Sheet>
	);
}
