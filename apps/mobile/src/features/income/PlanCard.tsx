import type { BudgetBefore } from "@orbita/shared";
import { colors, radius, spacing } from "@orbita/tokens";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { ApiError } from "../../lib/api.ts";
import { useClock } from "../../lib/clock.tsx";
import { money } from "../../lib/format.ts";
import { errorMessage, toLoadable } from "../../lib/loadable.ts";
import { Button, Chip, ConfirmDialog, Icon, ProgressBar, Skeleton, Text } from "../../ui/index.ts";
import {
	appliedMessage,
	canApplyPlan,
	hasUndo,
	planBarParts,
	planRows,
	planWarningText,
	RESERVE_OPTIONS,
	replaceMessage,
} from "./income-model.ts";
import { useApplyPlan, usePlan, useRestoreBudgets } from "./queries.ts";

/**
 * "Organizar com a minha renda" (Orçamento): o plano do mês feito pelo servidor com a renda cadastrada, em baldes
 * (compromissos, dia a dia, metas, reserva, sobra), os avisos e "Aplicar ao orçamento". Aplicar troca limites que
 * o dono já definiu, então pede confirmação; logo depois dá para desfazer.
 */
export function PlanCard({ hidden }: { hidden: boolean }) {
	const router = useRouter();
	const { month } = useClock();
	const [reserve, setReserve] = useState<number | undefined>(undefined);
	const planQ = usePlan(month, reserve);
	const apply = useApplyPlan();
	const restore = useRestoreBudgets();
	const [confirm, setConfirm] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [undo, setUndo] = useState<BudgetBefore[] | null>(null);
	const state = toLoadable(planQ);

	const fail = (e: unknown) => setMessage(e instanceof ApiError ? e.message : errorMessage(e));

	if (state.phase === "loading") return <Skeleton height={220} />;
	if (state.phase === "error") {
		return (
			<View style={{ backgroundColor: colors.surface, borderRadius: radius.block, padding: spacing.xl }}>
				<Text variant="caption" tone="secondary" accessibilityRole="alert">
					{state.message}
				</Text>
			</View>
		);
	}
	const plan = state.data;

	const run = (confirmed: boolean) => {
		setConfirm(false);
		setMessage(null);
		setUndo(null);
		apply.mutate(
			{ month, reservePercent: reserve, confirm: confirmed },
			{
				onSuccess: (res) => {
					setMessage(appliedMessage(res.budgets.find((b) => b.scope === "total")?.limitCents ?? 0, hidden));
					setUndo(hasUndo(res.previous) ? res.previous : null);
				},
				onError: fail,
			},
		);
	};

	const doUndo = () => {
		if (!undo) return;
		restore.mutate(undo, {
			onSuccess: () => {
				setUndo(null);
				setMessage("Limites de antes restaurados.");
			},
			onError: fail,
		});
	};

	if (plan.incomeCents === 0) {
		return (
			<View
				style={{
					backgroundColor: colors.surface,
					borderRadius: radius.block,
					padding: spacing.xl,
					gap: spacing.md,
				}}
			>
				<Text variant="cardTitle" tone="secondary" accessibilityRole="header">
					Organizar com a minha renda
				</Text>
				<Text variant="body" tone="secondary">
					Cadastre o seu salário e a Órbita monta o plano do mês, sem nunca sugerir gastar mais do que entra.
				</Text>
				<Button
					label="Cadastrar renda"
					variant="secondary"
					compact
					onPress={() => router.push("/configuracoes/renda")}
				/>
			</View>
		);
	}

	const rows = planRows(plan);
	const applying = apply.isPending;
	return (
		<View
			style={{
				backgroundColor: colors.surface,
				borderRadius: radius.block,
				padding: spacing.xl,
				gap: spacing.lg,
			}}
		>
			<View style={{ gap: spacing.xs }}>
				<Text variant="cardTitle" tone="secondary" accessibilityRole="header">
					Organizar com a minha renda
				</Text>
				<Text variant="numberLarge">{money(plan.incomeCents, hidden, { sign: "never" })}</Text>
				<Text variant="caption" tone="secondary">
					de renda neste mês
				</Text>
			</View>

			<ProgressBar parts={planBarParts(rows)} />

			<View style={{ gap: spacing.md }}>
				{rows.map((r) => (
					<View key={r.key} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
						<View style={{ width: 10, height: 10, borderRadius: radius.pill, backgroundColor: r.color }} />
						<View style={{ flex: 1 }}>
							<Text variant="body">{r.label}</Text>
							{r.caption ? (
								<Text variant="caption" tone="secondary">
									{r.caption}
								</Text>
							) : null}
						</View>
						<Text variant="bodyStrong">
							{money(r.cents, hidden, { sign: r.cents < 0 ? "auto" : "never" })}
						</Text>
					</View>
				))}
			</View>

			{plan.warnings.map((w) => (
				<View
					key={w.code}
					accessibilityRole="alert"
					style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }}
				>
					<Icon name="alerta" size={18} color={colors.textSecondary} />
					<Text variant="caption" tone="secondary" style={{ flex: 1 }}>
						{planWarningText(w, hidden)}
					</Text>
				</View>
			))}

			<View style={{ gap: spacing.sm }}>
				<Text variant="caption" tone="secondary">
					Reserva de emergência
				</Text>
				<View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
					{RESERVE_OPTIONS.map((p) => (
						<Chip
							key={p}
							label={`${p}%`}
							active={plan.reservePercent === p}
							onPress={() => {
								setReserve(p);
								setMessage(null);
								setUndo(null);
							}}
						/>
					))}
				</View>
			</View>

			<Button
				label="Aplicar ao orçamento"
				loading={applying}
				disabled={!canApplyPlan(plan) || restore.isPending}
				onPress={() => (plan.replacesCount > 0 ? setConfirm(true) : run(false))}
			/>
			{message ? (
				<View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ gap: spacing.xs }}>
					<Text variant="caption" tone="secondary">
						{message}
					</Text>
					{undo ? (
						<Pressable
							accessibilityRole="button"
							accessibilityLabel="Desfazer"
							disabled={restore.isPending}
							hitSlop={8}
							onPress={doUndo}
							style={({ pressed }) => ({
								minHeight: 44,
								justifyContent: "center",
								alignSelf: "flex-start",
								opacity: pressed || restore.isPending ? 0.6 : 1,
							})}
						>
							<Text variant="bodyStrong">{restore.isPending ? "Desfazendo…" : "Desfazer"}</Text>
						</Pressable>
					) : null}
				</View>
			) : null}
			<ConfirmDialog
				visible={confirm}
				title="Trocar seus limites?"
				message={replaceMessage(plan.replacesCount)}
				confirmLabel="Aplicar ao orçamento"
				onConfirm={() => run(true)}
				onCancel={() => setConfirm(false)}
			/>
		</View>
	);
}
