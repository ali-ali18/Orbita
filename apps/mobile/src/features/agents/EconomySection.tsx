import type { ActivityDto, AgentDto, AgentUpdateBody, SavingsOpportunityDto } from "@orbita/shared";
import { colors, radius, spacing } from "@orbita/tokens";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useClock } from "../../lib/clock.tsx";
import { toLoadable } from "../../lib/loadable.ts";
import { usePrivacy } from "../../lib/privacy.tsx";
import { useAccent } from "../../lib/theme.tsx";
import { Button, Card, Chip, ConfirmDialog, ErrorState, Skeleton, Text } from "../../ui/index.ts";
import {
	ACTIVITY_EMPTY,
	ACTIVITY_EMPTY_NOTIFY,
	ACTIVITY_KIND_LABEL,
	AUTONOMY_OPTIONS,
	type Autonomy,
	activityWhen,
	autonomyOf,
	CONFIDENCE_LABEL,
	CONFIRM_REVERSIBLE,
	NEVER_DOES,
	OVERLAP_NOTE,
	opportunityValue,
	REVERSIBLE_DOES,
	SAVINGS_EMPTY,
	SAVINGS_EMPTY_NOTE,
	SAVINGS_SHOWN,
	savingsHeadline,
	undoneLabel,
	visibleOpportunities,
} from "./economy-model.ts";
import {
	useActivities,
	useActOnOpportunity,
	useIgnoreOpportunity,
	useSavings,
	useUndoActivity,
} from "./economy-queries.ts";

const errorText = (e: unknown) => (e instanceof Error ? e.message : "Não consegui. Tente de novo.");

/** Rótulo pequeno de bloco, no mesmo estilo das seções das configurações. */
function Legend({ title }: { title: string }) {
	return (
		<Text variant="caption" tone="secondary" accessibilityRole="header">
			{title}
		</Text>
	);
}

// ---------------------------------------------------------------- autonomia

function AutonomyPicker({
	value,
	saving,
	onPick,
}: {
	value: Autonomy;
	saving: boolean;
	onPick: (next: Autonomy) => void;
}) {
	const { accent } = useAccent();
	return (
		<View style={{ gap: spacing.sm }}>
			<Legend title="Autonomia" />
			<View
				accessibilityRole="radiogroup"
				style={{ backgroundColor: colors.surface, borderRadius: radius.group, overflow: "hidden" }}
			>
				{AUTONOMY_OPTIONS.map((o, i) => {
					const selected = o.id === value;
					return (
						<Pressable
							key={o.id}
							accessibilityRole="radio"
							accessibilityLabel={`${o.label}. ${o.caption}`}
							accessibilityState={{ checked: selected, disabled: saving }}
							disabled={saving}
							onPress={() => (selected ? undefined : onPick(o.id))}
							style={({ pressed }) => ({
								flexDirection: "row",
								alignItems: "center",
								gap: spacing.lg,
								minHeight: 64,
								paddingHorizontal: spacing.lg,
								paddingVertical: spacing.md,
								borderBottomWidth: i === AUTONOMY_OPTIONS.length - 1 ? 0 : 1,
								borderBottomColor: colors.border,
								opacity: pressed ? 0.8 : 1,
							})}
						>
							<View
								accessibilityElementsHidden
								style={{
									width: 22,
									height: 22,
									borderRadius: radius.pill,
									borderWidth: 2,
									borderColor: selected ? accent : colors.textTertiary,
									alignItems: "center",
									justifyContent: "center",
								}}
							>
								{selected ? (
									<View
										style={{
											width: 10,
											height: 10,
											borderRadius: radius.pill,
											backgroundColor: accent,
										}}
									/>
								) : null}
							</View>
							<View style={{ flex: 1 }}>
								<Text variant="body">{o.label}</Text>
								<Text variant="caption" tone="secondary">
									{o.caption}
								</Text>
							</View>
						</Pressable>
					);
				})}
			</View>
			<Text variant="caption" tone="tertiary">
				{value === "reversible" ? `${REVERSIBLE_DOES.join(" · ")}. ${NEVER_DOES}` : NEVER_DOES}
			</Text>
		</View>
	);
}

// ---------------------------------------------------------------- onde cortar

function OpportunityCard({
	o,
	busy,
	onAct,
	onIgnore,
}: {
	o: SavingsOpportunityDto;
	busy: boolean;
	onAct: (action: "cancel_reminder" | "create_limit") => void;
	onIgnore: () => void;
}) {
	const { hidden } = usePrivacy();
	const { value, caption } = opportunityValue(o, hidden);
	const primary = o.actions.find((a) => a.id !== "ignore");
	return (
		<View
			style={{
				backgroundColor: colors.surface,
				borderRadius: radius.inner,
				padding: spacing.lg,
				gap: spacing.sm,
			}}
		>
			<View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
				<Text variant="bodyStrong" style={{ flex: 1 }}>
					{o.title}
				</Text>
				<View style={{ alignItems: "flex-end" }}>
					<Text variant="bodyStrong">{value}</Text>
					<Text variant="micro" tone="secondary">
						{caption}
					</Text>
				</View>
			</View>
			<Text variant="body" tone="secondary">
				{hidden ? "••••" : o.body}
			</Text>
			<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" }}>
				<Chip label={CONFIDENCE_LABEL[o.confidence]} />
				{o.countsInTotal ? null : (
					<Text variant="micro" tone="tertiary">
						{OVERLAP_NOTE}
					</Text>
				)}
			</View>
			<View style={{ flexDirection: "row", gap: spacing.sm, justifyContent: "flex-end", flexWrap: "wrap" }}>
				{primary && (primary.id === "cancel_reminder" || primary.id === "create_limit") ? (
					<Button
						label={primary.label}
						compact
						disabled={busy}
						onPress={() => onAct(primary.id as "cancel_reminder" | "create_limit")}
					/>
				) : null}
				<Button label="Ignorar" variant="secondary" compact disabled={busy} onPress={onIgnore} />
			</View>
		</View>
	);
}

function SavingsBlock() {
	const savingsQ = useSavings();
	const ignore = useIgnoreOpportunity();
	const act = useActOnOpportunity();
	const { hidden } = usePrivacy();
	const [expanded, setExpanded] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const state = toLoadable(savingsQ);
	const busy = ignore.isPending || act.isPending;

	const run = async (fn: () => Promise<unknown>) => {
		setError(null);
		try {
			await fn();
		} catch (e) {
			setError(errorText(e));
		}
	};

	return (
		<View style={{ gap: spacing.sm }}>
			<Legend title="Onde cortar" />
			{state.phase === "loading" ? (
				<Skeleton height={140} />
			) : state.phase === "error" ? (
				<ErrorState message={state.message} onRetry={state.retry} />
			) : state.data.opportunities.length === 0 ? (
				<View style={{ gap: spacing.xs }}>
					<Text variant="body" tone="secondary">
						{SAVINGS_EMPTY}
					</Text>
					<Text variant="caption" tone="tertiary">
						{SAVINGS_EMPTY_NOTE}
					</Text>
				</View>
			) : (
				<>
					{savingsHeadline(state.data.totalMonthlySavingsCents, hidden) ? (
						<Card highlight>
							<Text
								variant="numberMedium"
								accessibilityLabel={savingsHeadline(state.data.totalMonthlySavingsCents, hidden) ?? ""}
							>
								{savingsHeadline(state.data.totalMonthlySavingsCents, hidden)}
							</Text>
						</Card>
					) : null}
					<View style={{ gap: spacing.md }}>
						{visibleOpportunities(state.data.opportunities, expanded).map((o) => (
							<OpportunityCard
								key={o.key}
								o={o}
								busy={busy}
								onAct={(action) => void run(() => act.mutateAsync({ key: o.key, action }))}
								onIgnore={() => void run(() => ignore.mutateAsync(o.key))}
							/>
						))}
					</View>
					{state.data.opportunities.length > SAVINGS_SHOWN ? (
						<Button
							label={expanded ? "Ver menos" : `Ver todos (${state.data.opportunities.length})`}
							variant="secondary"
							compact
							onPress={() => setExpanded((v) => !v)}
						/>
					) : null}
				</>
			)}
			{error ? (
				<View accessibilityRole="alert" accessibilityLiveRegion="polite">
					<Text variant="caption" tone="secondary">
						{error}
					</Text>
				</View>
			) : null}
		</View>
	);
}

// ------------------------------------------------------------------- registro

function ActivityRow({ a, busy, onUndo }: { a: ActivityDto; busy: boolean; onUndo: () => void }) {
	const { today } = useClock();
	const { hidden } = usePrivacy();
	const undone = undoneLabel(a);
	return (
		<View
			style={{
				backgroundColor: colors.surface,
				borderRadius: radius.inner,
				padding: spacing.lg,
				gap: spacing.sm,
			}}
		>
			<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
				<Chip label={ACTIVITY_KIND_LABEL[a.kind]} />
				<View style={{ flex: 1 }} />
				<Text variant="caption" tone="secondary">
					{activityWhen(a, new Date(), today)}
				</Text>
			</View>
			<Text variant="bodyStrong" style={{ opacity: undone ? 0.6 : 1 }}>
				{a.summary}
			</Text>
			<Text variant="body" tone="secondary">
				{hidden ? "••••" : a.reason}
			</Text>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "space-between",
					gap: spacing.md,
				}}
			>
				<Text variant="caption" tone="tertiary" style={{ flex: 1 }}>
					{a.evidenceTransactionIds.length > 0
						? `Evidência: ${a.evidenceTransactionIds.length} ${a.evidenceTransactionIds.length === 1 ? "lançamento" : "lançamentos"}`
						: ""}
				</Text>
				{undone ? (
					<Text variant="caption" tone="secondary" style={{ flexShrink: 1, textAlign: "right" }}>
						{undone}
					</Text>
				) : (
					<Button label="Desfazer" variant="secondary" compact disabled={busy} onPress={onUndo} />
				)}
			</View>
		</View>
	);
}

function ActivityBlock({ autonomy }: { autonomy: Autonomy }) {
	const activitiesQ = useActivities();
	const undo = useUndoActivity();
	const [error, setError] = useState<string | null>(null);
	const state = toLoadable(activitiesQ);

	const onUndo = async (id: string) => {
		setError(null);
		try {
			await undo.mutateAsync(id);
		} catch (e) {
			setError(errorText(e));
		}
	};

	return (
		<View style={{ gap: spacing.sm }}>
			<Legend title="O que fiz sozinho" />
			{state.phase === "loading" ? (
				<Skeleton height={100} />
			) : state.phase === "error" ? (
				<ErrorState message={state.message} onRetry={state.retry} />
			) : state.data.activities.length === 0 ? (
				<Text variant="body" tone="secondary">
					{autonomy === "notify" ? ACTIVITY_EMPTY_NOTIFY : ACTIVITY_EMPTY}
				</Text>
			) : (
				<View style={{ gap: spacing.md }}>
					{state.data.activities.map((a) => (
						<ActivityRow key={a.id} a={a} busy={undo.isPending} onUndo={() => void onUndo(a.id)} />
					))}
				</View>
			)}
			{error ? (
				<View accessibilityRole="alert" accessibilityLiveRegion="polite">
					<Text variant="caption" tone="secondary">
						{error}
					</Text>
				</View>
			) : null}
		</View>
	);
}

// ----------------------------------------------------------------------- tudo

/** A parte do agente Economia na tela dele: autonomia, "Onde cortar" e o registro com Desfazer. */
export function EconomySection({
	agent,
	saving,
	onSave,
}: {
	agent: AgentDto;
	saving: boolean;
	onSave: (body: AgentUpdateBody) => Promise<boolean>;
}) {
	const autonomy = autonomyOf(agent.settings);
	const [confirming, setConfirming] = useState(false);

	return (
		<>
			<AutonomyPicker
				value={autonomy}
				saving={saving}
				onPick={(next) =>
					next === "reversible" ? setConfirming(true) : void onSave({ settings: { autonomy: next } })
				}
			/>
			<SavingsBlock />
			<ActivityBlock autonomy={autonomy} />
			<ConfirmDialog
				visible={confirming}
				title={CONFIRM_REVERSIBLE.title}
				message={CONFIRM_REVERSIBLE.message}
				confirmLabel={CONFIRM_REVERSIBLE.confirmLabel}
				onCancel={() => setConfirming(false)}
				onConfirm={() => {
					setConfirming(false);
					void onSave({ settings: { autonomy: "reversible" } });
				}}
			/>
		</>
	);
}
