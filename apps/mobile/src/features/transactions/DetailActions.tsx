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

/** Fileira de ações do Figma ("acoes"): blocos iguais lado a lado. Confirmar só aparece se está pendente. */
export function DetailActions({
	pending,
	busy,
	onConfirm,
	onEditDescription,
	onDelete,
}: {
	pending: boolean;
	busy: boolean;
	onConfirm: () => void;
	onEditDescription: () => void;
	onDelete: () => void;
}) {
	return (
		<View style={{ flexDirection: "row", gap: spacing.sm }}>
			{pending ? <Tile icon="check" label="Confirmar" onPress={onConfirm} busy={busy} /> : null}
			<Tile icon="lapis" label="Descrição" onPress={onEditDescription} busy={busy} />
			<Tile icon="lixeira" label="Apagar" onPress={onDelete} muted busy={busy} />
		</View>
	);
}
