import { colors, layout, radius, spacing } from "@orbita/tokens";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
	Animated,
	BackHandler,
	KeyboardAvoidingView,
	Modal,
	PanResponder,
	Platform,
	Pressable,
	ScrollView,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { dragOffset, shouldDismiss } from "./sheet-model.ts";
import { Text } from "./Text.tsx";

const native = Platform.OS !== "web";

/**
 * Gaveta única do app: ancorada embaixo, sobre tudo (inclusive barra e teclado do chat), indo até a borda
 * da tela (o conteúdo ganha folga da área segura). Barrinha no topo, sem botão de fechar; um título, se houver,
 * é só texto. Fecha tocando no fundo, arrastando a barrinha para baixo ou no botão voltar do Android.
 * O conteúdo rola se passar de 80% da altura. Modal do RN: funciona no celular e na web.
 */
export function Sheet({
	visible,
	title,
	onClose,
	children,
}: {
	visible: boolean;
	title?: string;
	onClose: () => void;
	children: ReactNode;
}) {
	const insets = useSafeAreaInsets();
	const drag = useRef(new Animated.Value(0)).current;
	const closeRef = useRef(onClose);
	closeRef.current = onClose;
	const [height, setHeight] = useState(0);
	const heightRef = useRef(0);
	heightRef.current = height;

	// A cada abertura o painel volta ao repouso (um arrasto anterior pode tê-lo deixado fora da tela).
	useEffect(() => {
		if (visible) drag.setValue(0);
	}, [visible, drag]);

	useEffect(() => {
		if (!visible || Platform.OS !== "android") return;
		const sub = BackHandler.addEventListener("hardwareBackPress", () => {
			closeRef.current();
			return true;
		});
		return () => sub.remove();
	}, [visible]);

	const pan = useRef(
		PanResponder.create({
			onStartShouldSetPanResponder: () => true,
			onMoveShouldSetPanResponder: () => true,
			onPanResponderMove: (_event, g) => drag.setValue(dragOffset(g.dy)),
			onPanResponderRelease: (_event, g) => {
				if (shouldDismiss(g.dy, g.vy)) {
					Animated.timing(drag, {
						toValue: Math.max(heightRef.current, 400),
						duration: 150,
						useNativeDriver: native,
					}).start(() => closeRef.current());
					return;
				}
				Animated.spring(drag, { toValue: 0, useNativeDriver: native }).start();
			},
			onPanResponderTerminate: () => Animated.spring(drag, { toValue: 0, useNativeDriver: native }).start(),
		}),
	).current;

	return (
		<Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
			{/* A gaveta sobe com o teclado (campo de data digitada, por exemplo). */}
			<KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: "flex-end" }}>
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
				<Animated.View
					accessibilityViewIsModal
					onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
					style={{
						backgroundColor: colors.surface,
						borderTopLeftRadius: radius.card,
						borderTopRightRadius: radius.card,
						paddingHorizontal: spacing.lg,
						paddingBottom: Math.max(insets.bottom, layout.homeIndicator),
						maxHeight: "80%",
						transform: [{ translateY: drag }],
					}}
				>
					<View
						{...pan.panHandlers}
						accessibilityRole="adjustable"
						accessibilityLabel="Arrastar para baixo para fechar"
						style={{ alignItems: "center", paddingTop: spacing.sm, paddingBottom: spacing.md }}
					>
						<View
							style={{
								width: 36,
								height: 4,
								borderRadius: radius.pill,
								backgroundColor: colors.textTertiary,
							}}
						/>
					</View>
					{title ? (
						<Text
							variant="bodyStrong"
							accessibilityRole="header"
							style={{ textAlign: "center", paddingBottom: spacing.md }}
						>
							{title}
						</Text>
					) : null}
					<ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }}>
						{children}
					</ScrollView>
				</Animated.View>
			</KeyboardAvoidingView>
		</Modal>
	);
}
