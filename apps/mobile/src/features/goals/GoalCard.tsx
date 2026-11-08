import { colors, radius, spacing } from "@orbita/tokens";
import { View } from "react-native";
import { money } from "../../lib/format.ts";
import { Card, Chip, Icon, ProgressBar, Text } from "../../ui/index.ts";
import { barWeights, type GoalLike, goalCaption, goalColor, goalIcon, statusLabel } from "./goals-model.ts";

/** Círculo do ícone da meta (Figma: 44, `surface2`); a cor da meta fica na barra, nunca no texto. */
export function GoalIconCircle({ goal, size = 44 }: { goal: Pick<GoalLike, "icon">; size?: number }) {
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={{
				width: size,
				height: size,
				borderRadius: radius.pill,
				backgroundColor: colors.surface2,
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			<Icon name={goalIcon(goal.icon)} size={20} />
		</View>
	);
}

/** Barra da meta: a parte guardada na cor da meta, o resto no trilho (`surface3`). */
export function GoalBar({ goal }: { goal: Pick<GoalLike, "percent" | "chartSlot"> }) {
	const { done, rest } = barWeights(goal.percent);
	return (
		<ProgressBar
			parts={[
				{ key: "done", color: goalColor(goal.chartSlot), weight: done },
				{ key: "rest", color: colors.surface3, weight: rest },
			]}
		/>
	);
}

/** Cartão da lista (Figma "Metas"): ícone, nome, "Até julho de 2027 · R$ 737 por mês", situação, barra e valores. */
export function GoalCard({
	goal,
	hidden,
	onPress,
}: {
	goal: GoalLike;
	hidden: boolean;
	onPress: () => void;
}) {
	const saved = money(goal.savedCents, hidden, { sign: "never" });
	const target = money(goal.targetCents, hidden, { sign: "never" });
	const caption = goalCaption(goal);
	return (
		<Card
			onPress={onPress}
			label={`${goal.name}, ${caption}, ${statusLabel(goal.status)}. Guardado ${saved} de ${target}. Abrir`}
			style={{ gap: spacing.lg }}
		>
			<View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
				<GoalIconCircle goal={goal} />
				<View style={{ flex: 1, gap: 2 }}>
					<Text variant="bodyStrong" numberOfLines={1}>
						{goal.name}
					</Text>
					<Text variant="caption" tone="secondary" numberOfLines={2}>
						{caption}
					</Text>
				</View>
				<Chip label={statusLabel(goal.status)} />
			</View>
			<GoalBar goal={goal} />
			<View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
				<Text variant="bodyStrong">{saved}</Text>
				<Text variant="caption" tone="secondary">{`de ${target}`}</Text>
			</View>
		</Card>
	);
}
