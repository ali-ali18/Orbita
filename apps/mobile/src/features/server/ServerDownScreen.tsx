import { colors, radius, spacing } from "@orbita/tokens";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useSession } from "../../lib/session.tsx";
import { Button, OrbitaAvatar, Screen, Text } from "../../ui/index.ts";
import { useNow } from "../banks/use-now.ts";
import {
	lastContactAt,
	SERVER_DOWN_CHANGE,
	SERVER_DOWN_REASONS,
	SERVER_DOWN_REASONS_TITLE,
	SERVER_DOWN_RETRY,
	SERVER_DOWN_TITLE,
	serverDownCaption,
} from "./server-model.ts";

/** Último dado que o app guardou deste servidor (qualquer consulta com resposta). */
function useLastContact(): number | null {
	const queryClient = useQueryClient();
	const { baseUrl } = useSession();
	const states = queryClient
		.getQueryCache()
		.findAll({ predicate: (q) => baseUrl !== null && q.queryKey[0] === baseUrl })
		.map((q) => ({ dataUpdatedAt: q.state.dataUpdatedAt, hasData: q.state.data !== undefined }));
	return lastContactAt(states);
}

/**
 * Estado "Servidor fora do ar" (Figma 55:1262): ocupa a tela no lugar do erro genérico.
 * `onRetry` refaz o que falhou. Não promete fila de lançamentos: o app ainda não guarda nada offline.
 */
export function ServerDownScreen({ onRetry }: { onRetry: () => Promise<unknown> }) {
	const router = useRouter();
	const { baseUrl } = useSession();
	const now = useNow();
	const lastContact = useLastContact();
	const [retrying, setRetrying] = useState(false);

	const retry = async () => {
		setRetrying(true);
		try {
			await onRetry();
		} finally {
			setRetrying(false);
		}
	};

	return (
		<Screen>
			<View style={{ flex: 1, paddingHorizontal: spacing.xl, paddingBottom: spacing.xl }}>
				<View style={{ flex: 1, justifyContent: "center", gap: spacing.lg }}>
					<View style={{ alignItems: "center", gap: spacing.md }}>
						<OrbitaAvatar size={96} color={colors.textSecondary} />
						<Text variant="numberMedium" style={{ textAlign: "center" }} accessibilityRole="header">
							{SERVER_DOWN_TITLE}
						</Text>
						<Text variant="caption" tone="secondary" style={{ textAlign: "center" }}>
							{serverDownCaption(lastContact, baseUrl, now)}
						</Text>
					</View>
					<View
						style={{
							backgroundColor: colors.surface,
							borderRadius: radius.block,
							padding: spacing.lg,
							gap: spacing.md,
						}}
					>
						<Text variant="caption" tone="secondary">
							{SERVER_DOWN_REASONS_TITLE}
						</Text>
						{SERVER_DOWN_REASONS.map((reason) => (
							<View key={reason} style={{ flexDirection: "row", gap: spacing.md, alignItems: "center" }}>
								<View
									style={{
										width: 6,
										height: 6,
										borderRadius: radius.pill,
										backgroundColor: colors.textSecondary,
									}}
								/>
								<Text variant="body" style={{ flex: 1 }}>
									{reason}
								</Text>
							</View>
						))}
					</View>
				</View>
				<View style={{ gap: spacing.sm, alignItems: "center" }}>
					<Button
						label={SERVER_DOWN_RETRY}
						loading={retrying}
						onPress={() => void retry()}
						style={{ alignSelf: "stretch" }}
					/>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={SERVER_DOWN_CHANGE}
						onPress={() => router.push("/configuracoes/servidor")}
						style={{ minHeight: 44, justifyContent: "center" }}
					>
						<Text variant="bodyStrong" tone="secondary">
							{SERVER_DOWN_CHANGE}
						</Text>
					</Pressable>
				</View>
			</View>
		</Screen>
	);
}
