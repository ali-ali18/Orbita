import { colors, radius, spacing } from "@orbita/tokens";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { ApiError } from "../../lib/api.ts";
import { useClock } from "../../lib/clock.tsx";
import { money } from "../../lib/format.ts";
import { combineLoadables, errorMessage, toLoadable } from "../../lib/loadable.ts";
import { usePrivacy } from "../../lib/privacy.tsx";
import { ErrorState, IconButton, Screen, Skeleton, Text, TOP_FADE } from "../../ui/index.ts";
import { ServerDownScreen } from "../server/ServerDownScreen.tsx";
import { isUnreachableQuery } from "../server/server-model.ts";
import { useCategories, useSummary } from "../summary/queries.ts";
import { categoryDot } from "../transactions/new-transaction-model.ts";
import { BudgetPreferences, SuggestionLine } from "./BudgetExtras.tsx";
import { BudgetSheet } from "./BudgetSheet.tsx";
import {
	type BudgetRow,
	budgetRows,
	buildSetRequest,
	limitsExceedTotal,
	TOTAL_SCOPE,
	totalLimit,
	warnText,
	withUnassignedSpend,
} from "./budget-model.ts";
import { useBudgets, useRemoveBudget, useSetBudget } from "./queries.ts";

/** Barra de 6 do Figma: trilho `surface3`, preenchimento na cor da categoria. */
function LimitBar({ percent, color }: { percent: number; color: string }) {
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={{ height: 6, borderRadius: 3, backgroundColor: colors.surface3, overflow: "hidden" }}
		>
			<View style={{ width: `${percent}%`, height: 6, borderRadius: 3, backgroundColor: color }} />
		</View>
	);
}

function CategoryLine({
	row,
	hidden,
	alertPercent,
	onPress,
}: {
	row: BudgetRow;
	hidden: boolean;
	alertPercent: number;
	onPress: () => void;
}) {
	const status =
		row.limitCents === null
			? "Sem limite"
			: `${money(row.spentCents, hidden, { sign: "never" })} de ${money(row.limitCents, hidden, { sign: "never" })}`;
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={`${row.name}, ${status}${row.over ? ", passou do limite" : row.warn ? `, ${warnText(alertPercent).toLowerCase()}` : ""}. Mudar limite`}
			onPress={onPress}
			style={({ pressed }) => ({
				gap: spacing.sm,
				minHeight: 44,
				justifyContent: "center",
				opacity: pressed ? 0.8 : 1,
			})}
		>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
				<View
					style={{
						width: 10,
						height: 10,
						borderRadius: radius.pill,
						backgroundColor: categoryDot(row.chartSlot, row.slug),
					}}
				/>
				<Text variant="body" style={{ flex: 1 }} numberOfLines={1}>
					{row.name}
				</Text>
				<Text variant="caption" tone={row.limitCents === null ? "tertiary" : "secondary"}>
					{status}
				</Text>
			</View>
			{row.limitCents !== null ? (
				<LimitBar percent={row.fillPercent} color={categoryDot(row.chartSlot, row.slug)} />
			) : null}
			{row.over || row.warn ? (
				<Text variant="micro" tone="secondary">
					{row.over ? "Passou do limite" : warnText(alertPercent)}
				</Text>
			) : null}
		</Pressable>
	);
}

type Target = { scope: string; title: string; hint?: string; initial: number; hasLimit: boolean };

/**
 * Tela "Orçamento do mês" (Figma 43:868): o limite total e um limite por categoria. O gasto vem do resumo do mês.
 * "Sugestão da Órbita" (mediana dos últimos meses fechados, calculada pelo servidor), "Avisar quando passar de" e
 * "Sobra do mês vai para" (uma conta ou uma meta) só guardam a escolha: o push ainda não existe e nenhum dinheiro é movido.
 */
export function BudgetScreen() {
	const router = useRouter();
	const { hidden } = usePrivacy();
	const { month } = useClock();
	const budgetsQ = useBudgets();
	const summaryQ = useSummary(month);
	const categoriesQ = useCategories();
	const set = useSetBudget();
	const remove = useRemoveBudget();
	// `isPending` só muda no próximo render; a trava em ref barra o segundo toque no mesmo instante.
	const busy = useRef(false);
	const [target, setTarget] = useState<Target | null>(null);
	const [error, setError] = useState<string | null>(null);

	const state = combineLoadables(
		combineLoadables(toLoadable(budgetsQ), toLoadable(summaryQ)),
		toLoadable(categoriesQ),
	);
	const close = () => (router.canGoBack() ? router.back() : router.replace("/configuracoes"));

	const closeSheet = () => {
		setTarget(null);
		setError(null);
	};
	const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : errorMessage(e));

	const save = (cents: number) => {
		if (busy.current || !target) return;
		const built = buildSetRequest(target.scope, cents);
		if (!built.ok) {
			setError(built.message);
			return;
		}
		busy.current = true;
		setError(null);
		set.mutate(built.request, {
			onSuccess: closeSheet,
			onError: fail,
			onSettled: () => {
				busy.current = false;
			},
		});
	};

	const removeLimit = () => {
		if (busy.current || !target) return;
		busy.current = true;
		setError(null);
		remove.mutate(target.scope, {
			onSuccess: closeSheet,
			onError: fail,
			onSettled: () => {
				busy.current = false;
			},
		});
	};

	const renderBody = () => {
		if (state.phase === "loading") {
			return (
				<View accessibilityLabel="Carregando" style={{ gap: spacing.md }}>
					<Skeleton height={120} />
					<Skeleton height={220} />
				</View>
			);
		}
		if (state.phase === "error") return <ErrorState message={state.message} onRetry={state.retry} />;
		const [[{ budgets }, { summary }], { categories }] = state.data;
		const total = totalLimit(budgets);
		const alerts = new Set(state.data[0][1].budgets.filter((b) => b.alert).map((b) => b.scope));
		const rows = withUnassignedSpend(
			budgetRows(categories, budgets, summary.byCategory, alerts),
			summary.spentCents,
		);
		const alertPercent = state.data[0][1].budgetAlertPercent;
		return (
			<>
				<View
					style={{
						backgroundColor: colors.surface,
						borderRadius: radius.block,
						padding: spacing.xl,
						gap: spacing.md,
					}}
				>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={
							total === null
								? "Quanto quero gastar por mês, sem limite. Definir"
								: `Quanto quero gastar por mês, ${money(total, hidden, { sign: "never" })}. Mudar`
						}
						onPress={() =>
							setTarget({
								scope: TOTAL_SCOPE,
								title: "Limite do mês",
								hint: "Quanto você quer gastar por mês, no total.",
								initial: total ?? 0,
								hasLimit: total !== null,
							})
						}
						style={({ pressed }) => ({ gap: 6, opacity: pressed ? 0.8 : 1 })}
					>
						<Text variant="caption" tone="secondary">
							Quanto quero gastar por mês
						</Text>
						<Text variant="numberLarge" tone={total === null ? "tertiary" : "primary"}>
							{total === null ? "Definir limite" : money(total, hidden, { sign: "never" })}
						</Text>
						<Text variant="caption" tone="secondary">
							Gasto {money(summary.spentCents, hidden, { sign: "never" })} neste mês
						</Text>
						{total !== null && limitsExceedTotal(rows, total) ? (
							<Text variant="caption" tone="secondary">
								Os limites das categorias somam mais que o total do mês.
							</Text>
						) : null}
					</Pressable>
					<SuggestionLine budgets={budgets} categories={categories} hidden={hidden} />
				</View>

				<View style={{ gap: spacing.sm, paddingTop: 6 }}>
					<Text variant="caption" tone="secondary" accessibilityRole="header">
						Por categoria
					</Text>
					<View
						style={{
							backgroundColor: colors.surface,
							borderRadius: radius.group,
							padding: spacing.lg,
							gap: spacing.lg,
						}}
					>
						{rows.length === 0 ? (
							<Text variant="body" tone="secondary">
								Nenhuma categoria cadastrada.
							</Text>
						) : (
							rows.map((r) => (
								<CategoryLine
									key={r.id}
									row={r}
									hidden={hidden}
									alertPercent={alertPercent}
									onPress={() =>
										setTarget({
											scope: r.id,
											title: `Limite de ${r.name}`,
											initial: r.limitCents ?? 0,
											hasLimit: r.limitCents !== null,
										})
									}
								/>
							))
						)}
					</View>
				</View>
				<BudgetPreferences />
			</>
		);
	};

	if (isUnreachableQuery(budgetsQ)) {
		return <ServerDownScreen onRetry={() => budgetsQ.refetch()} />;
	}

	return (
		<Screen fadeTop>
			<ScrollView
				contentContainerStyle={{
					paddingTop: TOP_FADE,
					paddingHorizontal: spacing.lg,
					paddingBottom: spacing.xxxl,
					gap: spacing.md,
				}}
				keyboardShouldPersistTaps="handled"
			>
				<View style={{ height: 44, justifyContent: "center", alignItems: "flex-start" }}>
					<IconButton icon="voltar" label="Voltar" onPress={close} />
				</View>
				<Text variant="greeting" accessibilityRole="header" style={{ paddingVertical: spacing.xs }}>
					Orçamento do mês
				</Text>
				{renderBody()}
			</ScrollView>

			<BudgetSheet
				visible={target !== null}
				title={target?.title ?? ""}
				{...(target?.hint ? { hint: target.hint } : {})}
				initialCents={target?.initial ?? 0}
				canRemove={target?.hasLimit ?? false}
				saving={set.isPending}
				removing={remove.isPending}
				error={error}
				onSave={save}
				onRemove={removeLimit}
				onClose={closeSheet}
			/>
		</Screen>
	);
}
