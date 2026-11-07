import { colors, radius, spacing } from "@orbita/tokens";
import { Pressable, View } from "react-native";
import { Icon, LetterAvatar } from "../../ui/index.ts";

export function HomeHeader({
	initial,
	hidden,
	onToggleHidden,
	onAvatarPress,
}: {
	initial: string;
	hidden: boolean;
	onToggleHidden: () => void;
	/** Toque no avatar: abrir Configurações. */
	onAvatarPress: () => void;
}) {
	return (
		<View
			style={{
				paddingVertical: spacing.sm,
				flexDirection: "row",
				alignItems: "center",
				justifyContent: "space-between",
			}}
		>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel="Configurações"
				onPress={onAvatarPress}
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
					opacity: pressed ? 0.8 : 1,
				})}
			>
				<Icon name={hidden ? "olho-cortado" : "olho"} />
			</Pressable>
		</View>
	);
}
