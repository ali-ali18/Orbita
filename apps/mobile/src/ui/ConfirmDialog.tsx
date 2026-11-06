import { colors, radius, spacing } from "@orbita/tokens";
import { Modal, Pressable, View } from "react-native";
import { Button } from "./Button.tsx";
import { Text } from "./Text.tsx";

/** Confirmação de ação destrutiva. Modal do RN: funciona no celular e na web (onde `Alert` não existe). */
export function ConfirmDialog({
	visible,
	title,
	message,
	confirmLabel,
	cancelLabel = "Cancelar",
	onConfirm,
	onCancel,
}: {
	visible: boolean;
	title: string;
	message: string;
	confirmLabel: string;
	cancelLabel?: string;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	return (
		<Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
			<View style={{ flex: 1, justifyContent: "center", padding: spacing.lg }}>
				<Pressable
					accessibilityLabel={cancelLabel}
					onPress={onCancel}
					style={{
						position: "absolute",
						top: 0,
						left: 0,
						right: 0,
						bottom: 0,
						backgroundColor: colors.background,
						opacity: 0.85,
					}}
				/>
				<View
					accessibilityViewIsModal
					style={{
						backgroundColor: colors.surface,
						borderRadius: radius.card,
						padding: spacing.xl,
						gap: spacing.md,
					}}
				>
					<Text variant="numberMedium" accessibilityRole="header">
						{title}
					</Text>
					<Text variant="body" tone="secondary">
						{message}
					</Text>
					<View style={{ gap: spacing.sm, marginTop: spacing.md }}>
						<Button label={confirmLabel} onPress={onConfirm} />
						<Button label={cancelLabel} variant="secondary" onPress={onCancel} />
					</View>
				</View>
			</View>
		</Modal>
	);
}
