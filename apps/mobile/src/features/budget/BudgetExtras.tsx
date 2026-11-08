import { spacing } from "@orbita/tokens";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { formatWholeReais } from "../../lib/format.ts";
import { errorMessage, toLoadable } from "../../lib/loadable.ts";
import { ConfirmDialog, OrbitaAvatar, Sheet, SheetGroup, SheetRow, Text } from "../../ui/index.ts";
import { selectableGoals } from "../goals/goals-model.ts";
import { useGoals } from "../goals/queries.ts";
import { leftoverLabel, selectableAccounts } from "../settings/preferences-model.ts";
import { usePreferences, useUpdatePreferences } from "../settings/preferences-queries.ts";
import { SettingsRow, SettingsSection } from "../settings/SettingsRows.tsx";
import { useAccounts } from "../summary/queries.ts";
import {
	ALERT_CAPTION,
	ALERT_PERCENT_OPTIONS,
	type BudgetLike,
	type CategoryLike,
	changedByRequests,
	LEFTOVER_CAPTION,
	replacedCount,
	type SuggestionLike,
	suggestionCaption,
	suggestionRequests,
} from "./budget-model.ts";
import { useApplySuggestion, useBudgetSuggestion } from "./queries.ts";

/** "Sugestão da Órbita" (Figma 43:880): linha do card do total, com o botão "Usar sugestão". Some sem histórico. */
export function SuggestionLine({
	budgets,
	categories,
	hidden,
}: {
	budgets: readonly BudgetLike[];
	categories: readonly CategoryLike[];
	hidden: boolean;
}) {
	const suggestionQ = useBudgetSuggestion();
	const apply = useApplySuggestion();
	const [confirm, setConfirm] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const state = toLoadable(suggestionQ);
	if (state.phase !== "ready") return null;
	const suggestion: SuggestionLike = state.data;
	if (suggestion.monthsUsed === 0 || suggestion.totalCents <= 0) return null;

	const pending = changedByRequests(suggestionRequests(suggestion, categories), budgets);
	const amount = hidden ? "R$ ••••" : formatWholeReais(suggestion.totalCents);
	const run = () => {
		setConfirm(false);
		setError(null);
		apply.mutate(pending, { onError: (e) => setError(errorMessage(e)) });
	};
	const replaced = replacedCount(pending, budgets);

	return (
		<View style={{ gap: spacing.sm }}>
			<View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
				<View style={{ paddingTop: 1 }}>
					<OrbitaAvatar size={18} />
				</View>
				<Text variant="caption" tone="secondary" style={{ flex: 1 }}>
					{suggestionCaption(suggestion, amount, hidden)}
				</Text>
			</View>
			{pending.length > 0 ? (
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Usar sugestão"
					accessibilityState={{ busy: apply.isPending, disabled: apply.isPending }}
					disabled={apply.isPending}
					hitSlop={8}
					onPress={() => (replaced > 0 ? setConfirm(true) : run())}
					style={({ pressed }) => ({
						minHeight: 44,
						justifyContent: "center",
						alignSelf: "flex-start",
						opacity: pressed || apply.isPending ? 0.6 : 1,
					})}
				>
					<Text variant="bodyStrong">{apply.isPending ? "Aplicando…" : "Usar sugestão"}</Text>
				</Pressable>
			) : (
				<Text variant="caption" tone="tertiary">
					Seus limites já seguem a sugestão.
				</Text>
			)}
			{error ? (
				<Text variant="caption" tone="secondary" accessibilityRole="alert">
					{error}
				</Text>
			) : null}
			<ConfirmDialog
				visible={confirm}
				title="Trocar seus limites?"
				message={`${replaced === 1 ? "1 limite que você definiu será trocado" : `${replaced} limites que você definiu serão trocados`} pelos valores sugeridos.`}
				confirmLabel="Usar sugestão"
				onConfirm={run}
				onCancel={() => setConfirm(false)}
			/>
		</View>
	);
}

/** "Avisar quando passar de X%" e "Sobra do mês vai para" (Figma 43:923): só guardam a escolha. */
export function BudgetPreferences() {
	const preferencesQ = usePreferences();
	const accountsQ = useAccounts();
	const goalsQ = useGoals();
	const update = useUpdatePreferences();
	const [sheet, setSheet] = useState<"alert" | "leftover" | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const preferences = toLoadable(preferencesQ);
	const accounts = toLoadable(accountsQ);
	const goals = toLoadable(goalsQ);
	if (preferences.phase !== "ready") return null;
	const { budgetAlertPercent, leftoverAccountId, leftoverGoalId } = preferences.data;
	const accountList = accounts.phase === "ready" ? accounts.data.accounts : [];
	// As metas (já só as ativas) chegam da lista; sem elas a escolha continua valendo, só não oferece metas.
	const goalList = goals.phase === "ready" ? selectableGoals(goals.data.goals) : [];

	const save = (
		patch:
			| { budgetAlertPercent: number }
			| { leftoverAccountId: string }
			| { leftoverGoalId: string }
			| { leftoverAccountId: null; leftoverGoalId: null },
	) => {
		setSheet(null);
		setMessage(null);
		update.mutate(patch, { onError: (e) => setMessage(errorMessage(e)) });
	};

	return (
		<View style={{ gap: spacing.sm }}>
			<SettingsSection>
				<SettingsRow
					title="Avisar quando passar de"
					caption="Por enquanto, o aviso aparece no Início"
					value={`${budgetAlertPercent}%`}
					onPress={() => setSheet("alert")}
				/>
				<SettingsRow
					last
					title="Sobra do mês vai para"
					value={leftoverLabel(accountList, goalList, {
						accountId: leftoverAccountId,
						goalId: leftoverGoalId,
					})}
					onPress={() => setSheet("leftover")}
				/>
			</SettingsSection>
			{message ? (
				<Text variant="caption" tone="secondary" accessibilityRole="alert">
					{message}
				</Text>
			) : null}

			<Sheet visible={sheet === "alert"} title="Avisar quando passar de" onClose={() => setSheet(null)}>
				<View style={{ paddingBottom: spacing.md }}>
					<SheetGroup>
						{ALERT_PERCENT_OPTIONS.map((p) => (
							<SheetRow
								key={p}
								label={`${p}% do limite`}
								role="radio"
								selected={p === budgetAlertPercent}
								onPress={() => save({ budgetAlertPercent: p })}
							/>
						))}
					</SheetGroup>
					<Text variant="caption" tone="secondary" style={{ paddingHorizontal: spacing.xs }}>
						{ALERT_CAPTION}
					</Text>
				</View>
			</Sheet>

			<Sheet visible={sheet === "leftover"} title="Sobra do mês vai para" onClose={() => setSheet(null)}>
				<View style={{ paddingBottom: spacing.md }}>
					<SheetGroup>
						<SheetRow
							label="Nenhuma"
							role="radio"
							selected={leftoverAccountId === null && leftoverGoalId === null}
							onPress={() => save({ leftoverAccountId: null, leftoverGoalId: null })}
						/>
						{selectableAccounts(accountList).map((a) => (
							<SheetRow
								key={a.id}
								label={a.name}
								caption="Conta"
								role="radio"
								selected={leftoverAccountId === a.id}
								onPress={() => save({ leftoverAccountId: a.id })}
							/>
						))}
						{goalList.map((g) => (
							<SheetRow
								key={g.id}
								label={g.name}
								caption="Meta"
								role="radio"
								selected={leftoverGoalId === g.id}
								onPress={() => save({ leftoverGoalId: g.id })}
							/>
						))}
					</SheetGroup>
					<Text variant="caption" tone="secondary" style={{ paddingHorizontal: spacing.xs }}>
						{LEFTOVER_CAPTION}
					</Text>
				</View>
			</Sheet>
		</View>
	);
}
