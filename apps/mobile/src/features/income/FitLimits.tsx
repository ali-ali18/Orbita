import type { BudgetBefore } from "@orbita/shared";
import { spacing } from "@orbita/tokens";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { ApiError } from "../../lib/api.ts";
import { errorMessage } from "../../lib/loadable.ts";
import { Button, Text } from "../../ui/index.ts";
import { hasUndo } from "./income-model.ts";
import { useFitBudgets, useRestoreBudgets } from "./queries.ts";

/**
 * Os limites das categorias somam mais que o total do mês: "Ajustar para caber" pede ao servidor (engine) para
 * reduzi-los na proporção, sem mexer no que já é compromisso. Logo depois dá para desfazer.
 */
export function FitLimits() {
	const fit = useFitBudgets();
	const restore = useRestoreBudgets();
	const [message, setMessage] = useState<string | null>(null);
	const [undo, setUndo] = useState<BudgetBefore[] | null>(null);
	const fail = (e: unknown) => setMessage(e instanceof ApiError ? e.message : errorMessage(e));

	const run = () => {
		setMessage(null);
		setUndo(null);
		fit.mutate(undefined, {
			onSuccess: (res) => {
				setMessage("Limites ajustados para caber no total do mês.");
				setUndo(hasUndo(res.previous) ? res.previous : null);
			},
			onError: fail,
		});
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

	return (
		<View style={{ gap: spacing.sm }}>
			<Button
				label="Ajustar para caber"
				variant="secondary"
				compact
				loading={fit.isPending}
				disabled={restore.isPending}
				onPress={run}
			/>
			{message ? (
				<View accessibilityRole="alert" accessibilityLiveRegion="polite">
					<Text variant="caption" tone="secondary">
						{message}
					</Text>
				</View>
			) : null}
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
	);
}
