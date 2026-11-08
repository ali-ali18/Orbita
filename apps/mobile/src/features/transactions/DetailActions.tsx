import { colors, radius, spacing } from "@orbita/tokens";
import { Pressable, View } from "react-native";
import { Icon, type IconName, Text } from "../../ui/index.ts";

function Tile({
	icon,
	label,
	onPress,
	muted = false,
	busy = false,
}: {
	icon: IconName;
	label: string;
	onPress: () => void;
	muted?: boolean;
	busy?: boolean;
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityState={{ disabled: busy, busy }}
			disabled={busy}
			onPress={onPress}
			style={({ pressed }) => ({
				flex: 1,
				minHeight: 72,
				alignItems: "center",
				justifyContent: "center",
				gap: spacing.sm - 2,
				paddingVertical: spacing.md + 2,
				borderRadius: radius.group,
				backgroundColor: colors.surface,
				opacity: busy ? 0.4 : pressed ? 0.8 : 1,
			})}
		>
			<Icon name={icon} size={20} color={muted ? colors.textSecondary : colors.text} />
			<Text variant="caption" tone={muted ? "secondary" : "primary"}>
				{label}
			</Text>
		</Pressable>
	);
}

/**
 * Fileira de ações do Figma ("acoes"): Dividir, Repetir e Apagar, blocos iguais lado a lado. Confirmar só aparece
 * se está pendente; Dividir e Repetir só nos lançamentos que aceitam (despesa e receita avulsas). A descrição se
 * edita pelas reticências do topo.
 */
export function DetailActions({
	pending,
	busy,
	splittable,
	repeatable,
	onConfirm,
	onSplit,
	onRepeat,
	onDelete,
}: {
	pending: boolean;
	busy: boolean;
	splittable: boolean;
	repeatable: boolean;
	onConfirm: () => void;
	onSplit: () => void;
	onRepeat: () => void;
	onDelete: () => void;
}) {
	return (
		<View style={{ flexDirection: "row", gap: spacing.sm }}>
			{pending ? <Tile icon="check" label="Confirmar" onPress={onConfirm} busy={busy} /> : null}
			{splittable ? <Tile icon="dividir" label="Dividir" onPress={onSplit} busy={busy} /> : null}
			{repeatable ? <Tile icon="repetir" label="Repetir" onPress={onRepeat} busy={busy} /> : null}
			<Tile icon="lixeira" label="Apagar" onPress={onDelete} muted busy={busy} />
		</View>
	);
}
