import { spacing } from "@orbita/tokens";
import type { ErrorBoundaryProps } from "expo-router";
import { View } from "react-native";
import { ChatScreen } from "../features/chat/ChatScreen.tsx";
import { Button, Screen, Text } from "../ui/index.ts";

export default function ChatRoute() {
	return <ChatScreen />;
}

/** Erro de JavaScript ao montar ou usar o chat: mostra um aviso amigável em vez de derrubar a tela. */
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
	return (
		<Screen>
			<View style={{ flex: 1, justifyContent: "center", gap: spacing.md, padding: spacing.lg }}>
				<Text variant="bodyStrong">Não consegui abrir o chat</Text>
				<Text variant="body" tone="secondary">
					Algo deu errado ao abrir a conversa com a Órbita. Seus dados estão seguros.
				</Text>
				<Button label="Tentar de novo" onPress={() => void retry()} />
			</View>
		</Screen>
	);
}
