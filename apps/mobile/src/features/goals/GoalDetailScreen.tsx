import { colors, layout, spacing } from "@orbita/tokens";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { ApiError } from "../../lib/api.ts";
import { useClock } from "../../lib/clock.tsx";
import { dayMonth, money, relativeDate } from "../../lib/format.ts";
import { errorMessage, toLoadable } from "../../lib/loadable.ts";
import { usePrivacy } from "../../lib/privacy.tsx";
import {
	Button,
	Card,
	Chip,
	ConfirmDialog,
	ErrorState,
	IconButton,
	Screen,
	Skeleton,
	Text,
	TOP_FADE,
} from "../../ui/index.ts";
import { ServerDownScreen } from "../server/ServerDownScreen.tsx";
import { isUnreachableQuery } from "../server/server-model.ts";
import { ValueSheet } from "../subscriptions/SubscriptionSheets.tsx";
import { GoalBar, GoalIconCircle } from "./GoalCard.tsx";
import { deadlineMonthLabel, NO_MONEY_MOVES, perMonth, projectionLabel, statusLabel } from "./goals-model.ts";
import { useAddContribution, useArchiveGoal, useGoal, useRemoveContribution } from "./queries.ts";

function InfoRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
	return (
		<View
			accessible
			accessibilityLabel={`${label}, ${value}`}
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: spacing.lg,
				minHeight: layout.touchTarget,
				paddingVertical: spacing.md,
				borderBottomWidth: last ? 0 : 1,
				borderBottomColor: colors.border,
			}}
		>
			<Text variant="body" tone="secondary" style={{ flex: 1 }}>
				{label}
			</Text>
			<Text variant="bodyStrong">{value}</Text>
		</View>
	);
}

/**
 * Detalhe da meta: o guardado, a barra, o que falta, o valor por mês e a projeção no ritmo atual (tudo do engine),
 * o botão "Guardar" e a lista do que já foi guardado. Guardar só registra o valor: nenhum dinheiro é movido.
 */
export function GoalDetailScreen() {
	const router = useRouter();
	const { id } = useLocalSearchParams<{ id?: string }>();
	const goalId = typeof id === "string" && id !== "" ? id : null;
	const { today } = useClock();
	const { hidden } = usePrivacy();
	const goalQ = useGoal(goalId);
	const add = useAddContribution();
	const remove = useRemoveContribution();
	const archive = useArchiveGoal();
	// `isPending` só muda no próximo render; a trava em ref barra o segundo toque no mesmo instante.
	const busy = useRef(false);
	const [saving, setSaving] = useState(false);
	const [removingId, setRemovingId] = useState<string | null>(null);
	const [confirmingArchive, setConfirmingArchive] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [refreshing, setRefreshing] = useState(false);
	const state = toLoadable(goalQ);

	const close = () => (router.canGoBack() ? router.back() : router.replace("/metas"));
	const fail = (error: unknown) =>
		setMessage(error instanceof ApiError ? error.message : errorMessage(error));

	const save = (amountCents: number) => {
		if (busy.current || !goalId) return;
		busy.current = true;
		setSaving(false);
		setMessage(null);
		add.mutate(
			{ id: goalId, amountCents },
			{
				onError: fail,
				onSettled: () => {
					busy.current = false;
				},
			},
		);
	};

	const confirmRemove = () => {
		const contributionId = removingId;
		setRemovingId(null);
		if (busy.current || !goalId || contributionId === null) return;
		busy.current = true;
		setMessage(null);
		remove.mutate(
			{ id: goalId, contributionId },
			{
				onError: fail,
				onSettled: () => {
					busy.current = false;
				},
			},
		);
	};

	const confirmArchive = () => {
		setConfirmingArchive(false);
		if (busy.current || !goalId) return;
		busy.current = true;
		archive.mutate(goalId, {
			onSuccess: close,
			onError: fail,
			onSettled: () => {
				busy.current = false;
			},
		});
	};

	const onRefresh = async () => {
		setRefreshing(true);
		try {
			await goalQ.refetch();
		} finally {
			setRefreshing(false);
		}
	};

	const renderBody = () => {
		if (goalId === null) {
			return (
				<Text variant="body" tone="secondary">
					Não encontrei essa meta.
				</Text>
			);
		}
		if (state.phase === "loading") {
			return (
				<View accessibilityLabel="Carregando" style={{ gap: spacing.md }}>
					<Skeleton height={120} />
					<Skeleton height={160} />
				</View>
			);
		}
		if (state.phase === "error") {
			if (goalQ.error instanceof ApiError && goalQ.error.status === 404) {
				return (
					<Text variant="body" tone="secondary">
						Não encontrei essa meta.
					</Text>
				);
			}
			return <ErrorState message={state.message} onRetry={state.retry} />;
		}
		const { goal, contributions } = state.data;
		const archived = goal.archivedAt !== null;
		const saved = money(goal.savedCents, hidden, { sign: "never" });
		const target = money(goal.targetCents, hidden, { sign: "never" });
		const projection = projectionLabel(goal);
		return (
			<>
				<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
					<GoalIconCircle goal={goal} />
					<View style={{ flex: 1, gap: spacing.xs }}>
						<Text variant="numberMedium" numberOfLines={2} accessibilityRole="header">
							{goal.name}
						</Text>
					</View>
					<Chip label={archived ? "Arquivada" : statusLabel(goal.status)} />
				</View>

				<View style={{ gap: spacing.xs }}>
					<Text variant="cardTitle" tone="secondary">
						Guardado
					</Text>
					<Text variant="numberHero">{saved}</Text>
					<Text variant="caption" tone="secondary">
						{`de ${target} · ${goal.percent}%`}
					</Text>
				</View>
				<GoalBar goal={goal} />

				<Card style={{ paddingVertical: spacing.sm }}>
					<InfoRow
						label="Falta"
						value={money(goal.remainingCents, hidden, { sign: "never" })}
						last={goal.deadline === null && projection === null}
					/>
					{goal.deadline !== null ? (
						<InfoRow label="Prazo" value={deadlineMonthLabel(goal.deadline)} last={goal.reached} />
					) : null}
					{goal.monthlyNeededCents !== null && !goal.reached ? (
						<InfoRow label="Para chegar no prazo" value={perMonth(goal.monthlyNeededCents)} last />
					) : null}
				</Card>
				{projection ? (
					<Text variant="caption" tone="secondary">
						{projection}
					</Text>
				) : null}

				{message ? (
					<Text variant="caption" tone="secondary" accessibilityRole="alert" accessibilityLiveRegion="polite">
						{message}
					</Text>
				) : null}

				{archived ? null : (
					<View style={{ gap: spacing.md }}>
						<Button label="Guardar" icon="mais" loading={add.isPending} onPress={() => setSaving(true)} />
						<Text variant="caption" tone="secondary">
							{NO_MONEY_MOVES}
						</Text>
					</View>
				)}

				<View style={{ gap: spacing.sm }}>
					<Text variant="cardTitle" tone="secondary" accessibilityRole="header">
						{contributions.length === 0 ? "Nada guardado ainda" : "O que você guardou"}
					</Text>
					{contributions.length > 0 ? (
						<Card style={{ paddingVertical: spacing.xs }}>
							{contributions.map((c, i) => (
								<View
									key={c.id}
									style={{
										flexDirection: "row",
										alignItems: "center",
										gap: spacing.md,
										minHeight: layout.touchTarget + spacing.sm,
										borderBottomWidth: i === contributions.length - 1 ? 0 : 1,
										borderBottomColor: colors.border,
									}}
								>
									<View style={{ flex: 1 }}>
										<Text variant="body">{relativeDate(c.date, today)}</Text>
										{c.date.slice(0, 4) !== today.slice(0, 4) ? (
											<Text variant="caption" tone="tertiary">
												{`${dayMonth(c.date)} de ${c.date.slice(0, 4)}`}
											</Text>
										) : null}
									</View>
									<Text variant="bodyStrong">{money(c.amountCents, hidden, { sign: "never" })}</Text>
									{archived ? null : (
										<IconButton
											icon="lixeira"
											label={`Apagar o que guardou em ${relativeDate(c.date, today)}`}
											size={36}
											background={colors.surface2}
											onPress={() => setRemovingId(c.id)}
										/>
									)}
								</View>
							))}
						</Card>
					) : null}
				</View>

				{archived ? null : (
					<View style={{ alignItems: "center", paddingTop: spacing.sm }}>
						<Button
							label="Arquivar meta"
							variant="secondary"
							loading={archive.isPending}
							onPress={() => setConfirmingArchive(true)}
						/>
					</View>
				)}

				<ValueSheet
					visible={saving}
					cents={0}
					title="Guardar"
					doneLabel="Guardar"
					onClose={() => setSaving(false)}
					onDone={save}
				/>
				<ConfirmDialog
					visible={removingId !== null}
					title="Apagar este valor?"
					message="Ele deixa de contar no que você guardou nesta meta. Nenhum dinheiro é movido."
					confirmLabel="Apagar"
					onConfirm={confirmRemove}
					onCancel={() => setRemovingId(null)}
				/>
				<ConfirmDialog
					visible={confirmingArchive}
					title="Arquivar esta meta?"
					message="Ela some da lista. O que você guardou fica registrado, e a sobra do mês deixa de ir para ela."
					confirmLabel="Arquivar"
					onConfirm={confirmArchive}
					onCancel={() => setConfirmingArchive(false)}
				/>
			</>
		);
	};

	if (isUnreachableQuery(goalQ)) return <ServerDownScreen onRetry={() => goalQ.refetch()} />;

	const editable = state.phase === "ready" && state.data.goal.archivedAt === null;
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
				<View style={{ flexDirection: "row", alignItems: "center", minHeight: layout.touchTarget }}>
					<IconButton icon="voltar" label="Voltar" onPress={close} />
					<View style={{ flex: 1 }} />
					{editable ? (
						<IconButton
							icon="lapis"
							label="Editar meta"
							onPress={() => router.push({ pathname: "/nova-meta", params: { id: goalId ?? "" } })}
						/>
					) : null}
				</View>
				{renderBody()}
			</ScrollView>
		</Screen>
	);
}
