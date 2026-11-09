import { HOME_WIDGETS, type HomeLayoutItem, type HomeWidgetSize } from "@orbita/shared";
import { colors, spacing } from "@orbita/tokens";
import { Pressable } from "react-native";
import { Icon, type IconName, Segmented, Sheet, SheetGroup, Text } from "../../../ui/index.ts";

function Row({
	icon,
	label,
	danger = false,
	onPress,
}: {
	icon: IconName;
	label: string;
	danger?: boolean;
	onPress: () => void;
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			onPress={onPress}
			style={({ pressed }) => ({
				minHeight: 56,
				flexDirection: "row",
				alignItems: "center",
				gap: spacing.md,
				paddingHorizontal: spacing.lg,
				opacity: pressed ? 0.8 : 1,
			})}
		>
			<Icon name={icon} size={20} color={danger ? colors.danger : colors.text} />
			<Text variant="body" tone={danger ? "danger" : "primary"}>
				{label}
			</Text>
		</Pressable>
	);
}

/**
 * O menu de segurar um widget: esconder os valores (o mesmo olho do topo), abrir a edição, tirar o widget do Início
 * e trocar o tamanho. Só aparecem os tamanhos que o widget tem.
 */
export function WidgetMenu({
	item,
	valuesHidden,
	onToggleValues,
	onEdit,
	onRemove,
	onSize,
	onClose,
}: {
	item: HomeLayoutItem | null;
	valuesHidden: boolean;
	onToggleValues: () => void;
	onEdit: () => void;
	onRemove: () => void;
	onSize: (size: HomeWidgetSize) => void;
	onClose: () => void;
}) {
	const def = item ? HOME_WIDGETS[item.id] : null;
	const act = (run: () => void) => () => {
		onClose();
		run();
	};
	return (
		<Sheet visible={item !== null} {...(def ? { title: def.label } : {})} onClose={onClose}>
			{item && def ? (
				<>
					<SheetGroup>
						<Row
							icon={valuesHidden ? "olho" : "olho-cortado"}
							label={valuesHidden ? "Mostrar dados" : "Ocultar dados"}
							onPress={act(onToggleValues)}
						/>
						<Row icon="lapis" label="Editar widgets" onPress={act(onEdit)} />
						<Row icon="lixeira" label="Remover" danger onPress={act(onRemove)} />
					</SheetGroup>
					{def.sizes.length > 1 ? (
						<Segmented
							options={def.sizes.map((s) => ({ id: s, label: s }))}
							value={item.size}
							onChange={(size) => onSize(size)}
						/>
					) : null}
				</>
			) : null}
		</Sheet>
	);
}
