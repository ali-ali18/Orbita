import { colors, layout, spacing } from "@orbita/tokens";
import { useRouter } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { money } from "../../lib/format.ts";
import { toLoadable } from "../../lib/loadable.ts";
import { usePrivacy } from "../../lib/privacy.tsx";
import { Button, ErrorState, IconButton, Screen, Skeleton, Text, TOP_FADE } from "../../ui/index.ts";
import { ServerDownScreen } from "../server/ServerDownScreen.tsx";
import { isUnreachableQuery } from "../server/server-model.ts";
import { GoalCard } from "./GoalCard.tsx";
import { EMPTY_TEXT, totalsCaption } from "./goals-model.ts";
import { useGoals } from "./queries.ts";

/**
 * Tela "Metas" (Figma 54:1118): o total guardado, de quanto, e um cartão por meta com a barra e a situação.
 * Os números vêm da API (engine). O cartão "Metas diz" do Figma não existe: é texto de agente, e os agentes
 * ainda não foram construídos.
 */
export function GoalsScreen() {
	const router = useRouter();
	const { hidden } = usePrivacy();
	const goalsQ = useGoals();
	const [refreshing, setRefreshing] = useState(false);
	const state = toLoadable(goalsQ);

	const close = () => (router.canGoBack() ? router.back() : router.replace("/"));
	const create = () => router.push("/nova-meta");

	const onRefresh = async () => {
		setRefreshing(true);
		try {
			await goalsQ.refetch();
		} finally {
			setRefreshing(false);
		}
	};

	const renderBody = () => {
		if (state.phase === "loading") {
			return (
				<View accessibilityLabel="Carregando" style={{ gap: spacing.md }}>
					<Skeleton height={110} />
					<Skeleton height={146} />
					<Skeleton height={146} />
				</View>
			);
		}
		if (state.phase === "error") return <ErrorState message={state.message} onRetry={state.retry} />;
		const { goals, totals } = state.data;
		return (
			<>
				<View style={{ gap: spacing.xs }}>
					<Text variant="greeting" accessibilityRole="header">
						Metas
					</Text>
					<Text variant="cardTitle" tone="secondary">
						Guardado até agora
					</Text>
					<Text variant="numberHero">{money(totals.savedCents, hidden, { sign: "never" })}</Text>
					{goals.length > 0 ? (
						<Text variant="caption" tone="secondary">
							{totalsCaption(money(totals.targetCents, hidden, { sign: "never" }), goals.length)}
						</Text>
					) : null}
				</View>

				{goals.length === 0 ? (
					<Text variant="body" tone="secondary">
						{EMPTY_TEXT}
					</Text>
				) : (
					<View style={{ gap: spacing.md }}>
						{goals.map((g) => (
							<GoalCard
								key={g.id}
								goal={g}
								hidden={hidden}
								onPress={() => router.push({ pathname: "/meta", params: { id: g.id } })}
							/>
						))}
					</View>
				)}

				<View style={{ alignItems: "center", paddingTop: spacing.sm }}>
					<Button label="Nova meta" variant="secondary" icon="mais" onPress={create} />
				</View>
			</>
		);
	};

	if (isUnreachableQuery(goalsQ)) return <ServerDownScreen onRetry={() => goalsQ.refetch()} />;

	return (
		<Screen fadeTop>
			<ScrollView
				contentContainerStyle={{
					paddingTop: TOP_FADE,
					paddingHorizontal: spacing.lg,
					paddingBottom: spacing.xxxl,
					gap: spacing.xxl,
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
						flexDirection: "row",
						alignItems: "center",
						minHeight: layout.touchTarget,
						gap: spacing.sm,
					}}
				>
					<IconButton icon="voltar" label="Voltar" onPress={close} />
					<View style={{ flex: 1 }} />
					<IconButton icon="mais" iconSize={22} label="Nova meta" filled onPress={create} />
				</View>
				{renderBody()}
			</ScrollView>
		</Screen>
	);
}
