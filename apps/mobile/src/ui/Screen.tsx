import { colors, spacing } from "@orbita/tokens";
import type { ReactNode } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Fundo preto da tela, respeitando as áreas seguras. `footer` fica fixo embaixo (fora da rolagem). */
export function Screen({
	children,
	footer,
	style,
}: {
	children: ReactNode;
	footer?: ReactNode;
	style?: StyleProp<ViewStyle>;
}) {
	const insets = useSafeAreaInsets();
	return (
		<View style={[{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }, style]}>
			<View style={{ flex: 1 }}>{children}</View>
			{footer ? (
				<View style={{ paddingBottom: Math.max(insets.bottom, spacing.md) }}>{footer}</View>
			) : (
				<View style={{ height: insets.bottom }} />
			)}
		</View>
	);
}
