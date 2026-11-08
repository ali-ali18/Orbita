import { agents as agentTokens, colors, layout, radius, spacing } from "@orbita/tokens";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useClock } from "../../lib/clock.tsx";
import { toLoadable } from "../../lib/loadable.ts";
import { Button, ErrorState, IconButton, Screen, Skeleton, Text, TOP_FADE } from "../../ui/index.ts";
import { ServerDownScreen } from "../server/ServerDownScreen.tsx";
import { isUnreachableQuery } from "../server/server-model.ts";
import { AgentAvatar } from "./AgentAvatar.tsx";
import { activeCountLabel, previewOf, splitAgents, visualKey, whenLabel } from "./agents-model.ts";
import { useAgents, useUpdateAgent } from "./queries.ts";

type AgentItem = NonNullable<ReturnType<typeof useAgents>["data"]>["agents"][number];

/** Uma linha de "Seus agentes" (Figma 39:578): rosto, nome, hora do último aviso, última frase e a bolinha de "novo". */
function AgentRow({ agent, onPress }: { agent: AgentItem; onPress: () => void }) {
	const { today } = useClock();
	const when = agent.latestAlert ? whenLabel(agent.latestAlert.createdAt, new Date(), today) : "";
	const unread = agent.alertsNew > 0;
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={`${agent.name}. ${previewOf(agent)}${unread ? ". Aviso novo" : ""}. Abrir`}
			onPress={onPress}
			style={({ pressed }) => ({
				flexDirection: "row",
				alignItems: "center",
				gap: spacing.lg,
				minHeight: 64,
				opacity: pressed ? 0.8 : 1,
			})}
		>
			<View
				style={{
					width: 56,
					height: 56,
					borderRadius: radius.pill,
					backgroundColor: agentTokens[visualKey(agent)].tint,
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<AgentAvatar visual={visualKey(agent)} size={36} name={agent.name} />
			</View>
			<View style={{ flex: 1, gap: spacing.xs }}>
				<View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.sm }}>
					<Text variant="bodyStrong">{agent.name}</Text>
					{when ? (
						<Text variant="caption" tone="secondary">
							{when}
						</Text>
					) : null}
				</View>
				<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
					<Text variant="body" tone="secondary" numberOfLines={1} style={{ flex: 1 }}>
						{previewOf(agent)}
					</Text>
					{unread ? (
						<View
							accessibilityElementsHidden
							style={{ width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.accent }}
						/>
					) : null}
				</View>
			</View>
		</Pressable>
	);
}

/** Cartão de "Para ativar": o rosto sobre o tom do agente, o que ele faz e o botão Ativar. */
function ActivateCard({
	agent,
	busy,
	onOpen,
	onActivate,
}: {
	agent: AgentItem;
	busy: boolean;
	onOpen: () => void;
	onActivate: () => void;
}) {
	return (
		<View
			style={{
				width: 176,
				backgroundColor: colors.surface,
				borderRadius: radius.card,
				padding: spacing.md,
				gap: spacing.md,
			}}
		>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={`${agent.name}. ${agent.tagline}. Abrir`}
				onPress={onOpen}
				style={{ gap: spacing.md }}
			>
				<View
					style={{
						height: 100,
						borderRadius: radius.block,
						backgroundColor: agentTokens[visualKey(agent)].tint,
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<AgentAvatar visual={visualKey(agent)} size={64} name={agent.name} />
				</View>
				<Text variant="bodyStrong">{agent.name}</Text>
				<Text variant="caption" tone="secondary" numberOfLines={3}>
					{agent.tagline}
				</Text>
			</Pressable>
			<Button label="Ativar" variant="secondary" compact loading={busy} onPress={onActivate} />
		</View>
	);
}

/**
 * Tela "Agentes" (Figma 39:578): os que estão ativos, com o último aviso de cada um, e os que faltam ativar. Os
 * avisos são decididos pelo worker (engine); aqui só se mostra, se liga e se abre a tela do agente.
 */
export function AgentsScreen() {
	const router = useRouter();
	const agentsQ = useAgents();
	const update = useUpdateAgent();
	const [refreshing, setRefreshing] = useState(false);
	const [activating, setActivating] = useState<string | null>(null);
	const state = toLoadable(agentsQ);

	const close = () => (router.canGoBack() ? router.back() : router.replace("/"));
	const create = () => router.push("/novo-agente");
	const open = (id: string) => router.push({ pathname: "/agente", params: { id } });

	const onRefresh = async () => {
		setRefreshing(true);
		try {
			await agentsQ.refetch();
		} finally {
			setRefreshing(false);
		}
	};

	const activate = async (id: string) => {
		setActivating(id);
		try {
			await update.mutateAsync({ id, body: { enabled: true } });
		} catch {
			// O cartão continua em "Para ativar"; o dono toca de novo.
		} finally {
			setActivating(null);
		}
	};

	const renderBody = () => {
		if (state.phase === "loading") {
			return (
				<View accessibilityLabel="Carregando" style={{ gap: spacing.md }}>
					<Skeleton height={64} />
					<Skeleton height={64} />
					<Skeleton height={64} />
				</View>
			);
		}
		if (state.phase === "error") return <ErrorState message={state.message} onRetry={state.retry} />;
		const { active, toActivate } = splitAgents(state.data.agents);
		return (
			<>
				<View style={{ gap: spacing.md }}>
					<View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
						<Text variant="cardTitle" tone="primary" accessibilityRole="header">
							Seus agentes
						</Text>
						<Text variant="caption" tone="secondary">
							{activeCountLabel(active.length)}
						</Text>
					</View>
					<View style={{ gap: spacing.md }}>
						{active.map((a) => (
							<AgentRow key={a.id} agent={a} onPress={() => open(a.id)} />
						))}
					</View>
				</View>
				{toActivate.length > 0 ? (
					<View style={{ gap: spacing.md }}>
						<Text variant="cardTitle" accessibilityRole="header">
							Para ativar
						</Text>
						<ScrollView
							horizontal
							showsHorizontalScrollIndicator={false}
							contentContainerStyle={{ gap: spacing.md }}
						>
							{toActivate.map((a) => (
								<ActivateCard
									key={a.id}
									agent={a}
									busy={activating === a.id}
									onOpen={() => open(a.id)}
									onActivate={() => void activate(a.id)}
								/>
							))}
						</ScrollView>
					</View>
				) : null}
			</>
		);
	};

	if (isUnreachableQuery(agentsQ)) return <ServerDownScreen onRetry={() => agentsQ.refetch()} />;

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
					<IconButton icon="mais" iconSize={22} label="Novo agente" filled onPress={create} />
				</View>
				<View style={{ gap: spacing.sm }}>
					<Text variant="greeting" accessibilityRole="header">
						Agentes
					</Text>
					<Text variant="body" tone="secondary">
						Cada agente cuida de uma parte do seu dinheiro. A Órbita coordena todos e responde no chat.
					</Text>
				</View>
				{renderBody()}
			</ScrollView>
		</Screen>
	);
}
