import type { AgentUpdateBody } from "@orbita/shared";
import { agents as agentTokens, colors, layout, radius, spacing } from "@orbita/tokens";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useClock } from "../../lib/clock.tsx";
import { toLoadable } from "../../lib/loadable.ts";
import { usePrivacy } from "../../lib/privacy.tsx";
import {
	Button,
	Chip,
	ConfirmDialog,
	ErrorState,
	IconButton,
	ProgressBar,
	Screen,
	Skeleton,
	Text,
	TOP_FADE,
} from "../../ui/index.ts";
import { barWeights, goalColor, statusLabel } from "../goals/goals-model.ts";
import { useGoals } from "../goals/queries.ts";
import { ServerDownScreen } from "../server/ServerDownScreen.tsx";
import { isUnreachableQuery } from "../server/server-model.ts";
import { mainModelChoices, modelLabel } from "../settings/ai-model.ts";
import { useAiSettings } from "../settings/ai-queries.ts";
import { SettingsRow, SettingsSection, StaticSwitch } from "../settings/SettingsRows.tsx";
import { ValueSheet } from "../subscriptions/SubscriptionSheets.tsx";
import { AgentAvatar } from "./AgentAvatar.tsx";
import { DaysSheet, ModelSheet, ScheduleSheet } from "./AgentSheets.tsx";
import {
	ALERT_EMPTY,
	ALERT_EMPTY_OFF,
	type SettingRow,
	scheduleLabel,
	settingOn,
	settingRows,
	settingsTitle,
	settingValue,
	toolsSummary,
	visibleAlerts,
	visualKey,
	whenLabel,
} from "./agents-model.ts";
import { useAgent, useAnswerAlert, useDeleteAgent, useUpdateAgent } from "./queries.ts";

type Sheet = "schedule" | "model" | "cents" | "days" | null;

/**
 * Tela de um agente (Figma "Vigia", "Fechamento", "Metas", "Caça-assinatura", "Cofrinho", "Agente · Órbita"):
 * o que ele vigia, quando olha, os avisos recentes, ligar e desligar e "Conversar". O que o Figma mostra e depende
 * de coisas que não existem (push, silêncio, horário estranho, comparar rendimento) não aparece.
 */
export function AgentScreen() {
	const router = useRouter();
	const { id } = useLocalSearchParams<{ id?: string }>();
	const agentId = typeof id === "string" ? id : null;
	const agentQ = useAgent(agentId);
	const goalsQ = useGoals();
	const aiQ = useAiSettings();
	const update = useUpdateAgent();
	const remove = useDeleteAgent();
	const answer = useAnswerAlert();
	const { hidden } = usePrivacy();
	const { today } = useClock();
	const [sheet, setSheet] = useState<Sheet>(null);
	const [editing, setEditing] = useState<SettingRow | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [refreshing, setRefreshing] = useState(false);
	const state = toLoadable(agentQ);

	const close = () => (router.canGoBack() ? router.back() : router.replace("/agentes"));

	const save = async (body: AgentUpdateBody) => {
		if (!agentId) return false;
		setError(null);
		try {
			await update.mutateAsync({ id: agentId, body });
			return true;
		} catch (e) {
			setError(e instanceof Error ? e.message : "Não consegui salvar. Tente de novo.");
			return false;
		}
	};

	const onRefresh = async () => {
		setRefreshing(true);
		try {
			await agentQ.refetch();
		} finally {
			setRefreshing(false);
		}
	};

	if (isUnreachableQuery(agentQ)) return <ServerDownScreen onRetry={() => agentQ.refetch()} />;

	const renderBody = () => {
		if (state.phase === "loading") {
			return (
				<View accessibilityLabel="Carregando" style={{ gap: spacing.md }}>
					<Skeleton height={220} />
					<Skeleton height={180} />
				</View>
			);
		}
		if (state.phase === "error") return <ErrorState message={state.message} onRetry={state.retry} />;
		const { agent, alerts } = state.data;
		const visual = visualKey(agent);
		const tokens = agentTokens[visual];
		const rows = agent.builtinKey ? settingRows(agent.builtinKey) : [];
		const shown = visibleAlerts(alerts);
		const badge = agent.alwaysOn ? "Sempre ativa" : agent.enabled ? "Ativo" : "Desativado";
		const modelChoices = mainModelChoices(aiQ.data?.modelOptions ?? []);

		const onRow = async (row: SettingRow) => {
			if (row.kind === "toggle") {
				await save({ settings: { [row.key]: !settingOn(row, agent.settings) } });
				return;
			}
			setError(null);
			setEditing(row);
			setSheet(row.kind === "cents" ? "cents" : "days");
		};

		return (
			<>
				<View
					style={{
						backgroundColor: tokens.tint,
						borderRadius: radius.block,
						padding: spacing.xl,
						alignItems: "center",
						gap: spacing.md,
					}}
				>
					<AgentAvatar visual={visual} size={96} name={agent.name} />
					<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
						<Text variant="numberMedium" accessibilityRole="header">
							{agent.name}
						</Text>
						<Chip label={badge} active={agent.enabled} />
					</View>
					<Text variant="caption" tone="secondary" style={{ textAlign: "center" }}>
						{agent.builtinKey ? agent.tagline : "Agente criado por você."}
					</Text>
				</View>

				<Button
					label={`Conversar com ${agent.name}`}
					icon="brilho"
					onPress={() => router.push({ pathname: "/chat", params: { agentId: agent.id } })}
				/>

				{agent.builtinKey === null ? (
					<SettingsSection title="Instruções">
						<SettingsRow title={agent.instructions ?? ""} info last />
						<SettingsRow title="Lê" value={toolsSummary(agent.tools)} info last />
					</SettingsSection>
				) : agent.alwaysOn ? (
					<SettingsSection title="O que eu faço">
						{agent.watches.map((w, i) => (
							<SettingsRow key={w} title={w} info last={i === agent.watches.length - 1} />
						))}
					</SettingsSection>
				) : (
					<SettingsSection title={settingsTitle(agent.builtinKey)}>
						{rows.map((row, i) => (
							<SettingsRow
								key={row.key}
								title={row.label}
								caption={row.caption}
								value={settingValue(row, agent.settings)}
								toggled={row.kind === "toggle" ? settingOn(row, agent.settings) : undefined}
								trailing={
									row.kind === "toggle" ? <StaticSwitch on={settingOn(row, agent.settings)} /> : undefined
								}
								chevron={row.kind !== "toggle"}
								last={i === rows.length - 1}
								onPress={update.isPending ? undefined : () => void onRow(row)}
							/>
						))}
					</SettingsSection>
				)}

				{agent.builtinKey === "metas" ? (
					<SettingsSection title="Metas que acompanho">
						{goalsQ.data && goalsQ.data.goals.length > 0 ? (
							goalsQ.data.goals.map((g, i) => (
								<View
									key={g.id}
									style={{
										flexDirection: "row",
										alignItems: "center",
										gap: spacing.lg,
										paddingHorizontal: spacing.lg,
										paddingVertical: spacing.md,
										borderBottomWidth: i === goalsQ.data.goals.length - 1 ? 0 : 1,
										borderBottomColor: colors.border,
									}}
								>
									<View style={{ flex: 1 }}>
										<Text variant="body">{g.name}</Text>
										<Text variant="caption" tone="secondary">
											{g.percent}% · {statusLabel(g.status)}
										</Text>
									</View>
									<View style={{ width: 90 }}>
										<ProgressBar
											parts={[
												{ key: "done", color: goalColor(g.chartSlot), weight: barWeights(g.percent).done },
												{ key: "rest", color: colors.surface3, weight: barWeights(g.percent).rest },
											]}
										/>
									</View>
								</View>
							))
						) : (
							<SettingsRow title="Você ainda não tem metas." info last />
						)}
					</SettingsSection>
				) : null}

				{agent.alwaysOn ? null : (
					<SettingsSection title="Quando e como">
						<SettingsRow
							title="Quando eu olho"
							value={scheduleLabel(agent.schedule)}
							onPress={() => {
								setError(null);
								setSheet("schedule");
							}}
						/>
						<SettingsRow
							title="Modelo"
							caption="Só deste agente"
							value={modelLabel(aiQ.data?.modelOptions ?? [], agent.model)}
							onPress={() => {
								setError(null);
								setSheet("model");
							}}
						/>
						{agent.builtinKey === null ? (
							<SettingsRow
								title="Ligado"
								toggled={agent.enabled}
								trailing={<StaticSwitch on={agent.enabled} />}
								chevron={false}
								last
								onPress={update.isPending ? undefined : () => void save({ enabled: !agent.enabled })}
							/>
						) : null}
					</SettingsSection>
				)}

				{agent.alwaysOn ? null : (
					<View style={{ gap: spacing.sm }}>
						<Text variant="caption" tone="secondary" accessibilityRole="header">
							Últimos avisos
						</Text>
						{shown.length === 0 ? (
							<Text variant="body" tone="secondary">
								{agent.enabled ? ALERT_EMPTY : ALERT_EMPTY_OFF}
							</Text>
						) : (
							<View style={{ gap: spacing.md }}>
								{shown.map((a) => (
									<Pressable
										key={a.id}
										accessibilityRole="button"
										accessibilityLabel={`${a.title}. ${a.body}${a.status === "new" ? ". Novo" : ""}`}
										onPress={() =>
											a.status === "new" ? answer.mutate({ id: a.id, action: "seen" }) : undefined
										}
										style={{
											backgroundColor: colors.surface,
											borderRadius: radius.inner,
											padding: spacing.lg,
											gap: spacing.sm,
										}}
									>
										<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
											{a.status === "new" ? (
												<View
													accessibilityElementsHidden
													style={{
														width: 8,
														height: 8,
														borderRadius: radius.pill,
														backgroundColor: colors.accent,
													}}
												/>
											) : null}
											<Text variant="bodyStrong" style={{ flex: 1 }}>
												{a.title}
											</Text>
											<Text variant="caption" tone="secondary">
												{whenLabel(a.createdAt, new Date(), today)}
											</Text>
										</View>
										<Text variant="body" tone="secondary">
											{hidden ? "••••" : a.body}
										</Text>
										<View
											style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
										>
											<Text variant="caption" tone="tertiary">
												{a.wordedByAi ? "Texto escrito pela IA" : "Texto padrão"}
											</Text>
											<Button
												label="Agora não"
												variant="secondary"
												compact
												onPress={() => answer.mutate({ id: a.id, action: "dismiss" })}
											/>
										</View>
									</Pressable>
								))}
							</View>
						)}
					</View>
				)}

				{error && sheet === null ? (
					<View accessibilityRole="alert" accessibilityLiveRegion="polite">
						<Text variant="caption" tone="secondary">
							{error}
						</Text>
					</View>
				) : null}

				{!agent.alwaysOn && !agent.enabled ? (
					<Button
						label={`Ativar ${agent.name}`}
						loading={update.isPending}
						onPress={() => void save({ enabled: true })}
					/>
				) : null}
				{!agent.alwaysOn && agent.enabled && agent.builtinKey !== null ? (
					<Button
						label={`Desativar ${agent.name}`}
						variant="secondary"
						loading={update.isPending}
						onPress={() => void save({ enabled: false })}
					/>
				) : null}
				{agent.builtinKey === null ? (
					<Button label="Apagar agente" variant="secondary" onPress={() => setConfirmDelete(true)} />
				) : null}

				<ScheduleSheet
					visible={sheet === "schedule"}
					schedule={agent.schedule}
					saving={update.isPending}
					error={error}
					onSave={(schedule) => void save({ schedule }).then((ok) => ok && setSheet(null))}
					onClose={() => setSheet(null)}
				/>
				<ModelSheet
					visible={sheet === "model"}
					choices={modelChoices}
					selected={agent.model}
					onSelect={(model) => void save({ model }).then((ok) => ok && setSheet(null))}
					onClose={() => setSheet(null)}
				/>
				<ValueSheet
					visible={sheet === "cents"}
					cents={editing ? Number(agent.settings[editing.key] ?? 0) : 0}
					title={editing?.label ?? "Valor"}
					doneLabel="Salvar"
					onClose={() => setSheet(null)}
					onDone={(cents) => {
						if (editing) void save({ settings: { [editing.key]: cents } }).then((ok) => ok && setSheet(null));
					}}
				/>
				<DaysSheet
					visible={sheet === "days"}
					days={Number(agent.settings.duplicateWindowDays ?? 3)}
					onSelect={(days) =>
						void save({ settings: { duplicateWindowDays: days } }).then((ok) => ok && setSheet(null))
					}
					onClose={() => setSheet(null)}
				/>
				<ConfirmDialog
					visible={confirmDelete}
					title="Apagar este agente?"
					message="Os avisos dele também somem. Os seus lançamentos e metas não mudam."
					confirmLabel="Apagar"
					onCancel={() => setConfirmDelete(false)}
					onConfirm={() => {
						setConfirmDelete(false);
						remove.mutate(agent.id, { onSuccess: () => router.replace("/agentes") });
					}}
				/>
			</>
		);
	};

	return (
		<Screen fadeTop>
			<ScrollView
				contentContainerStyle={{
					paddingTop: TOP_FADE,
					paddingHorizontal: spacing.lg,
					paddingBottom: spacing.xxxl,
					gap: spacing.lg,
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
				<View style={{ height: layout.touchTarget, justifyContent: "center", alignItems: "flex-start" }}>
					<IconButton icon="voltar" label="Voltar" onPress={close} />
				</View>
				{renderBody()}
			</ScrollView>
		</Screen>
	);
}
