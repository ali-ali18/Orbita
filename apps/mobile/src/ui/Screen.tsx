import { colors, layout } from "@orbita/tokens";
import type { ReactNode } from "react";
import { type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Fundo preto da tela, respeitando as áreas seguras. `footer` fica fixo embaixo (fora da rolagem);
 * com `floatingFooter` ele flutua sobre o conteúdo e cuida sozinho da área segura (a barra de baixo).
 */
export function Screen({
	children,
	footer,
	floatingFooter = false,
	style,
}: {
	children: ReactNode;
	footer?: ReactNode;
	floatingFooter?: boolean;
	style?: StyleProp<ViewStyle>;
}) {
	const insets = useSafeAreaInsets();
	return (
		<View
			style={[
				{ flex: 1, backgroundColor: colors.background, paddingTop: Math.max(insets.top, layout.statusBar) },
				style,
			]}
		>
			<View style={{ flex: 1 }}>{children}</View>
			{footer && floatingFooter ? (
				<View style={styles.floating} pointerEvents="box-none">
					{footer}
				</View>
			) : footer ? (
				<View style={{ paddingBottom: Math.max(insets.bottom, layout.homeIndicator) }}>{footer}</View>
			) : (
				<View style={{ height: insets.bottom }} />
			)}
		</View>
	);
}

const styles = StyleSheet.create({
	floating: { position: "absolute", left: 0, right: 0, bottom: 0 },
});
