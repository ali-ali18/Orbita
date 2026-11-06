import { colors, radius, spacing } from "@orbita/tokens";
import { Pressable, View } from "react-native";
import { Icon, LetterAvatar } from "../../ui/index.ts";

export function HomeHeader({
	initial,
	hidden,
	onToggleHidden,
	onSignOut,
}: {
	initial: string;
	hidden: boolean;
	onToggleHidden: () => void;
	/** Toque longo no avatar: desconectar este aparelho. */
	onSignOut: () => void;
}) {
	return (
		<View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel="Você. Segure para desconectar este aparelho"
				onLongPress={onSignOut}
				style={{ minWidth: 44, minHeight: 44, justifyContent: "center" }}
			>
				<LetterAvatar letter={initial} />
			</Pressable>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={hidden ? "Mostrar valores" : "Esconder valores"}
				accessibilityState={{ checked: hidden }}
				onPress={onToggleHidden}
				style={({ pressed }) => ({
					width: 44,
					height: 44,
					borderRadius: radius.pill,
					backgroundColor: colors.surface,
					alignItems: "center",
					justifyContent: "center",
					marginRight: spacing.xs,
					opacity: pressed ? 0.8 : 1,
				})}
			>
				<Icon name={hidden ? "eye-off" : "eye"} />
			</Pressable>
		</View>
	);
}
