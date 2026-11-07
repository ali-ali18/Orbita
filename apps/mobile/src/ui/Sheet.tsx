import { colors, layout, radius, spacing } from "@orbita/tokens";
import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconButton } from "./IconButton.tsx";
import { Text } from "./Text.tsx";

/**
 * Gaveta que sobe de baixo (cantos de cima `card`, fundo `surface`). Toque fora ou o botão de fechar
 * dispensam. O conteúdo rola se passar de 70% da altura. Modal do RN: funciona no celular e na web.
 */
export function Sheet({
	visible,
	title,
	onClose,
	children,
}: {
	visible: boolean;
	title: string;
	onClose: () => void;
	children: ReactNode;
}) {
	const insets = useSafeAreaInsets();
	return (
		<Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
			<View style={{ flex: 1, justifyContent: "flex-end" }}>
				<Pressable
					accessibilityLabel="Fechar"
					onPress={onClose}
					style={{
						position: "absolute",
						top: 0,
						left: 0,
						right: 0,
						bottom: 0,
						backgroundColor: colors.background,
						opacity: 0.7,
					}}
				/>
				<View
					accessibilityViewIsModal
					style={{
						backgroundColor: colors.surface,
						borderTopLeftRadius: radius.card,
						borderTopRightRadius: radius.card,
						paddingTop: spacing.lg,
						paddingHorizontal: spacing.xl,
						paddingBottom: Math.max(insets.bottom, layout.homeIndicator),
						maxHeight: "70%",
					}}
				>
					<View style={{ flexDirection: "row", alignItems: "center", minHeight: 44 }}>
						<Text variant="bodyStrong" accessibilityRole="header" style={{ flex: 1 }}>
							{title}
						</Text>
						<IconButton icon="fechar" label="Fechar" background={colors.surface2} onPress={onClose} />
					</View>
					<ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }}>
						{children}
					</ScrollView>
				</View>
			</View>
		</Modal>
	);
}
