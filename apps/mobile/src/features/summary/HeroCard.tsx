import { spacing } from "@orbita/tokens";
import { View } from "react-native";
import type { MonthSummary } from "../../lib/api.ts";
import { formatWholeReais, money, percentOf } from "../../lib/format.ts";
import { Card, ProgressBar, Text } from "../../ui/index.ts";
import { budgetBarSegments, type CategoryLike, categoryShares } from "./summary-model.ts";

/** Mesmo valor de `TOTAL_BUDGET_SCOPE` em `@orbita/db` (o app não importa o banco). */
const TOTAL_BUDGET_SCOPE = "total";

export function HeroCard({
	summary,
	categories,
	hidden,
}: {
	summary: MonthSummary;
	categories: readonly CategoryLike[];
	hidden: boolean;
}) {
	const total = summary.budgets.find((b) => b.scope === TOTAL_BUDGET_SCOPE);
	const safe = summary.safeToSpend;
	const spent = summary.summary.spentCents;

	if (!total || !safe) {
		return (
			<Card>
				<Text variant="cardTitle" tone="secondary">
					Dá pra gastar até o fim do mês
				</Text>
				<Text variant="body" tone="secondary" style={{ marginTop: spacing.md }}>
					Ainda não há orçamento para este mês. Defina um limite para ver quanto ainda dá pra gastar.
				</Text>
				<Text variant="caption" tone="secondary" style={{ marginTop: spacing.lg }}>
					Gasto {money(spent, hidden, { sign: "never" })}
				</Text>
			</Card>
		);
	}

	const shares = categoryShares(summary.summary.byCategory, categories);
	const bar = budgetBarSegments(shares, total.limitCents);
	const over = safe.availableCents < 0;
	const percent = total.ratio === null ? 100 : percentOf(spent, total.limitCents);

	return (
		<Card>
			<Text variant="cardTitle" tone="secondary">
				{over ? "Você passou do orçamento do mês" : "Dá pra gastar até o fim do mês"}
			</Text>
			<Text
				variant="numberHero"
				style={{ marginTop: spacing.xs }}
				adjustsFontSizeToFit
				numberOfLines={1}
				accessibilityLabel={hidden ? "Valor escondido" : undefined}
			>
				{money(safe.availableCents, hidden)}
			</Text>
			<Text variant="caption" tone="secondary" style={{ marginTop: spacing.sm }}>
				{`≈ ${hidden ? money(0, true) : formatWholeReais(safe.perDayCents)} por dia · orçamento de ${hidden ? money(0, true) : formatWholeReais(total.limitCents)}`}
			</Text>
			<View style={{ marginTop: spacing.lg }}>
				<ProgressBar parts={bar} />
			</View>
			<View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: spacing.sm }}>
				<Text variant="caption" tone="secondary">
					Gasto {money(spent, hidden, { sign: "never" })}
				</Text>
				<Text variant="caption" tone="secondary">
					{percent}% do orçamento
				</Text>
			</View>
		</Card>
	);
}
