import { colors, radius, spacing } from "@orbita/tokens";
import { Pressable, View } from "react-native";
import { Text } from "./Text.tsx";

/** Selo/filtro em pílula. `active` = chip ativo (branco). Sem `onPress` é só um selo. */
export function Chip({
	label,
	active = false,
	onPress,
}: {
	label: string;
	active?: boolean;
	onPress?: () => void;
}) {
	const body = (
		<View
			style={{
				paddingHorizontal: spacing.md,
				paddingVertical: spacing.xs + 2,
				borderRadius: radius.pill,
				backgroundColor: active ? colors.accent : colors.surface2,
			}}
		>
			<Text variant="micro" tone={active ? "onAccent" : "secondary"}>
				{label}
			</Text>
		</View>
	);
	if (!onPress) return body;
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityState={{ selected: active }}
			onPress={onPress}
			style={{ minHeight: 44, justifyContent: "center" }}
		>
			{body}
		</Pressable>
	);
}
