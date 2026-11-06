import { spacing } from "@orbita/tokens";
import { View } from "react-native";
import { Button } from "./Button.tsx";
import { Text } from "./Text.tsx";

/** Falha de um bloco: diz o que houve e oferece tentar de novo. Nunca finge que está vazio. */
export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
	return (
		<View accessibilityRole="alert" style={{ gap: spacing.md, alignItems: "flex-start" }}>
			<Text variant="caption" tone="secondary">
				{message}
			</Text>
			<Button label="Tentar de novo" variant="secondary" compact onPress={onRetry} />
		</View>
	);
}
