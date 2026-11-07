import { colors, radius } from "@orbita/tokens";
import { Pressable, View } from "react-native";
import { Text } from "./Text.tsx";

/** Abas em pílula (Faturas · Parcelas · Limites): a ativa em branco, as outras em `textSecondary`. */
export function Segmented<T extends string>({
	options,
	value,
	onChange,
}: {
	options: readonly { id: T; label: string }[];
	value: T;
	onChange: (next: T) => void;
}) {
	return (
		<View
			accessibilityRole="tablist"
			style={{
				flexDirection: "row",
				gap: 4,
				padding: 4,
				borderRadius: radius.pill,
				backgroundColor: colors.surface,
			}}
		>
			{options.map((o) => {
				const active = o.id === value;
				return (
					<Pressable
						key={o.id}
						accessibilityRole="tab"
						accessibilityLabel={o.label}
						accessibilityState={{ selected: active }}
						onPress={() => onChange(o.id)}
						style={{
							flex: 1,
							minHeight: 44,
							alignItems: "center",
							justifyContent: "center",
							borderRadius: radius.pill,
							backgroundColor: active ? colors.accent : "transparent",
						}}
					>
						<Text variant="bodyStrong" tone={active ? "onAccent" : "secondary"} numberOfLines={1}>
							{o.label}
						</Text>
					</Pressable>
				);
			})}
		</View>
	);
}
