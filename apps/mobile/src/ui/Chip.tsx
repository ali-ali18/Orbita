import { colors, radius, spacing } from "@orbita/tokens";
import { Pressable, View } from "react-native";
import { useAccent } from "../lib/theme.tsx";
import { Text } from "./Text.tsx";

/** Selo/filtro em pílula. `active` = chip ativo (cor primária do tema). Sem `onPress` é só um selo. */
export function Chip({
	label,
	active = false,
	onPress,
}: {
	label: string;
	active?: boolean;
	onPress?: () => void;
}) {
	const { accent } = useAccent();
	const body = (
		<View
			style={{
				paddingHorizontal: spacing.md,
				paddingVertical: spacing.sm,
				borderRadius: radius.pill,
				backgroundColor: active ? accent : colors.surface2,
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
