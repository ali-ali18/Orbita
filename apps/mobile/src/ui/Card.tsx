import { colors, radius, spacing } from "@orbita/tokens";
import type { ReactNode } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
	return (
		<View
			style={[{ backgroundColor: colors.surface, borderRadius: radius.card, padding: spacing.xl }, style]}
		>
			{children}
		</View>
	);
}
