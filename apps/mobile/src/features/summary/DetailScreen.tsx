import { colors, layout, spacing } from "@orbita/tokens";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { type ReactNode, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { usePrivacy } from "../../lib/privacy.tsx";
import { IconButton, Screen, Text } from "../../ui/index.ts";

/**
 * Casca das telas de detalhe dos cards do Início (Saldo em contas, Gasto do mês, Fluxo de caixa): voltar, olho, título,
 * legenda e puxar para atualizar. O conteúdo é de cada tela.
 */
export function DetailScreen({
	title,
	caption,
	children,
}: {
	title: string;
	caption?: string | null;
	children: ReactNode;
}) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const { hidden, toggle } = usePrivacy();
	const [refreshing, setRefreshing] = useState(false);

	const onRefresh = async () => {
		setRefreshing(true);
		try {
			await queryClient.invalidateQueries();
		} finally {
			setRefreshing(false);
		}
	};

	return (
		<Screen>
			<ScrollView
				contentContainerStyle={{
					paddingHorizontal: spacing.lg,
					paddingBottom: spacing.xxxl + spacing.lg,
					gap: spacing.md,
				}}
				refreshControl={
					<RefreshControl
						refreshing={refreshing}
						onRefresh={onRefresh}
						tintColor={colors.text}
						colors={[colors.text]}
						progressBackgroundColor={colors.surface2}
					/>
				}
			>
				<View
					style={{
						height: layout.touchTarget,
						flexDirection: "row",
						alignItems: "center",
						justifyContent: "space-between",
					}}
				>
					<IconButton
						icon="voltar"
						label="Voltar"
						onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
					/>
					<IconButton
						icon={hidden ? "olho-cortado" : "olho"}
						label={hidden ? "Mostrar valores" : "Esconder valores"}
						onPress={toggle}
					/>
				</View>
				<Text variant="greeting" accessibilityRole="header">
					{title}
				</Text>
				{caption ? (
					<Text variant="caption" tone="secondary">
						{caption}
					</Text>
				) : null}
				{children}
			</ScrollView>
		</Screen>
	);
}
